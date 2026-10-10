import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PiRpc } from './pi-rpc.mjs';
import { readJson, writeJson, relevantWant, timestamp, validateWorking, inside } from './project-state.mjs';

export function validateGate(text) {
  const v=JSON.parse(text.trim());
  const fields=['decision','resolution','reason','question','options','fingerprint'];
  if(!v || Array.isArray(v) || Object.keys(v).some(k=>!fields.includes(k)) || fields.some(k=>!(k in v)) ||
     !['CONTINUE','NEEDS_CODEX','NEEDS_ME'].includes(v.decision) || typeof v.fingerprint!=='string' || !v.fingerprint.trim() ||
     !Array.isArray(v.options) || v.options.length>6) throw new Error('Invalid Gate schema');
  for(const k of ['resolution','reason','question']) if(v[k]!==null && typeof v[k]!=='string') throw new Error('Invalid Gate text');
  const required={CONTINUE:'resolution',NEEDS_CODEX:'reason',NEEDS_ME:'question'}[v.decision];
  if(['resolution','reason','question'].some(k=>k!==required && v[k]!==null) || (v.decision!=='NEEDS_ME' && v.options.length) || JSON.stringify(v).length>8000) throw new Error('Unexpected Gate payload');
  if(!v[required]?.trim() || (v.decision==='NEEDS_ME' && (v.options.length<2 || v.options.some(o=>typeof o!=='string'||!o.trim()) || new Set(v.options).size<2))) throw new Error('Gate missing decision payload');
  return v;
}
export const blockerFingerprint=c => createHash('sha256').update(JSON.stringify({question:c.question?.trim().toLowerCase(),options:c.options})).digest('hex').slice(0,16);
export async function runGate(root,id,config,runDir,{call, onSession=()=>{}, onEvent=()=>{}, shouldStop=()=>false}={}) {
  const candidate=readJson(root,`.ai/work/${id}.decision.json`);
  if(candidate?.change_id!==id || !candidate.question?.trim() || !candidate.why_blocked?.trim() || !candidate.attempted_local_resolution?.trim() || !Array.isArray(candidate.options)) throw new Error('Invalid Decision Candidate');
  const work=validateWorking(readJson(root,`.ai/work/${id}.json`),id);
  const fp=blockerFingerprint(candidate);
  let decision;
  if ((work.last_gate_fingerprint===fp && work.last_gate_decision==='CONTINUE') || candidate.local_attempts>=2) {
    decision={decision:'NEEDS_CODEX',resolution:null,reason:'同一阻塞在已有修复后重现，需要针对性诊断。',question:null,options:[],fingerprint:fp};
  } else {
    const card=readFileSync(inside(root,`changes/active/${id}.md`),'utf8');
    const payload={want:relevantWant(root,card),card,work,candidate};
    const instructions=readFileSync(inside(root,'templates/OWNER_GATE_PROMPT.md'),'utf8');
    for(let attempt=0;attempt<2;attempt++) {
      if(shouldStop()) throw new Error('Gate stopped');
      const prompt=instructions+'\nReturn ONLY strict JSON with these exact keys: decision, resolution, reason, question, options (array of strings), fingerprint. Unused text fields null. CONTINUE requires resolution; NEEDS_CODEX requires reason; NEEDS_ME requires question and >=2 distinct options. Never choose for the Owner.\n'+JSON.stringify(payload)+(attempt?'\nPrevious response invalid. Reformat deterministically to the exact schema; no prose/code fences.':'');
      let rpc;
      try {
        let text;
        if(call) text=await call(prompt,attempt);
        else {
          rpc=new PiRpc(root,config,join(runDir,`gate-${attempt}`),{gate:true,onEvent}); onSession(rpc);
          let timer;
          try { text=await Promise.race([rpc.run(prompt),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Gate timeout')),120000);})]); }
          finally { clearTimeout(timer); }
          if(rpc.error) throw new Error(rpc.error);
        }
        decision=validateGate(text); break;
      } catch {
        if(shouldStop()) throw new Error('Gate stopped');
        if(attempt===1) decision={decision:'NEEDS_CODEX',resolution:null,reason:'Gate 输出未通过校验，需要诊断。',question:null,options:[],fingerprint:fp};
      } finally {
        if(rpc) {
          await rpc.close(); onSession(null);
          if(rpc.error && !shouldStop()) decision={decision:'NEEDS_CODEX',resolution:null,reason:'Gate 运行异常，需要诊断。',question:null,options:[],fingerprint:fp};
        }
      }
    }
  }
  decision.fingerprint=fp; // untrusted model cannot reset the anti-loop identity
  const latest=validateWorking(readJson(root,`.ai/work/${id}.json`),id);
  writeJson(root,`.ai/work/${id}.json`,{...latest,last_gate_fingerprint:fp,gate_attempts:(latest.gate_attempts||0)+1,last_gate_decision:decision.decision,updated_at:timestamp()});
  return decision;
}
