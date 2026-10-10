import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Native PI RPC, finite per-session process. JSONL splits only on LF.
export class PiRpc {
  constructor(root, config, runDir, { gate=false, onEvent=()=>{} } = {}) {
    this.sessionId = randomUUID(); this.pending = new Map(); this.onEvent = onEvent;
    this.text = ''; this.error = null; this.settled = null; this.closed = false;
    mkdirSync(runDir,{recursive:true}); this.eventPath = join(runDir,'events.jsonl');
    const args = [config.pi_cli, '--offline','--mode','rpc','--session-id',this.sessionId,'--session-dir',runDir,
      '--name', (gate?'gate-':'build-')+this.sessionId, '--no-extensions','-e',config.provider_extension,
      '--no-skills','--no-prompt-templates','--no-themes','--provider',config.provider,'--model',config.model,'--thinking',config.thinking];
    args.push(...(gate ? ['--no-tools','--no-context-files'] : ['--tools','read,bash,powershell,edit,write,grep,find,ls']));
    this.child = spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error', e=>this.fail(e));
    this.child.stderr.on('data', data=>appendFileSync(join(runDir,'stderr.log'),data));
    let buffer = ''; this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{
      buffer += chunk;
      let at;
      while ((at=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,at).replace(/\r$/,''); buffer=buffer.slice(at+1);
        if (!line.trim()) continue;
        appendFileSync(this.eventPath,line+'\n');
        try { this.event(JSON.parse(line)); } catch(e) { this.fail(e); }
      }
    });
    this.exit = new Promise(resolve=>this.child.on('close',(code,signal)=>{
      this.closed=true;
      if(code!==0 && !this.forcedExit && !this.error) this.error=`PI exited: ${code ?? signal}`;
      this.fail(new Error(`PI exited: ${code ?? signal}`)); resolve({code,signal});
    }));
    this.child.on('error',e=>this.fail(e));
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    if (this.settled) { this.settled.reject(error); this.settled=null; }
  }
  event(event) {
    if (event.type==='response') {
      const p=this.pending.get(event.id);
      if(p) { clearTimeout(p.timer); this.pending.delete(event.id); event.success ? p.resolve(event.data) : p.reject(new Error(event.error)); }
    }
    if (event.type==='message_end' && event.message?.role==='assistant') {
      this.text=(event.message.content || []).filter(c=>c.type==='text').map(c=>c.text).join('');
      if (['error','aborted'].includes(event.message.stopReason)) this.error = event.message.errorMessage || event.message.stopReason;
    }
    this.onEvent(event);
    if(event.type==='agent_settled' && this.settled) { const s=this.settled; this.settled=null; s.resolve(this.text); }
  }
  command(type, fields={}, timeout=30000) {
    if(this.closed) return Promise.reject(new Error('PI process is closed'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`PI command timeout: ${type}`));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,type,...fields})+'\n');
    });
  }
  async run(message) {
    if(this.settled) throw new Error('One active run per session');
    this.text=''; this.error=null;
    const done=new Promise((resolve,reject)=>{this.settled={resolve,reject};});
    // Register the settle listener BEFORE prompting; consume command failure too.
    const accepted=this.command('prompt',{message});
    try { await accepted; return await done; } catch(e) { this.fail(e); await done.catch(()=>{}); throw e; }
  }
  async abort() { await this.command('clear_queue'); await this.command('abort',{},15000); }
  async close() {
    if(this.closed) return this.exit;
    this.child.stdin.end();
    const timer=setTimeout(()=>{this.forcedExit=true;this.child.kill();},3000);
    const result=await this.exit; clearTimeout(timer); return result;
  }
}
