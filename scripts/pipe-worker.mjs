import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PiRpc } from './pi-rpc.mjs';
import { runGate } from './owner-gate.mjs';
import { startHome } from './project-home.mjs';
import { timestamp, readJson, writeJson, inside, git, changedFiles, validateWorking, refreshProjection } from './project-state.mjs';

export function validateTerminal(root,id,event,{accepted,currentChangeId,acceptedBaseline,acceptanceReceiptHash}={}) {
  if(event?.change_id!==id || !['RESULT_READY','OWNER_DECISION','NEEDS_CODEX','FAILED'].includes(event.status) || !event.summary?.trim()) throw new Error('Missing or invalid terminal event');
  if(event.status==='RESULT_READY') {
    if(event.receipt!==`receipts/${id}.md` || !readFileSync(inside(root,event.receipt),'utf8').trim()) throw new Error('Declared receipt missing');
    if(!/^[a-f\d]{7,40}$/i.test(event.result_commit)) throw new Error('Invalid result commit');
    git(root,'cat-file','-e',event.result_commit+'^{commit}');
    if(!event.owner_result?.trim()) throw new Error('Owner result missing');
    if(!/^https?:\/\//.test(event.owner_result)) readFileSync(inside(root,event.owner_result));
    const current=readJson(root,'results/CURRENT.json');
    const advances=currentChangeId && current.currentChange?.id===id && currentChangeId!==id;
    if(advances) {
      if(current.accepted!==null || current.candidates?.some(candidate=>candidate.accepted===true)) throw new Error('A new result needs separate Owner acceptance');
      if(accepted===true && !acceptedBaseline)throw new Error('Accepted baseline has no recoverable pointer');
    } else if(accepted!==undefined && JSON.stringify(current?.accepted)!==JSON.stringify(accepted)) throw new Error('Builder cannot sign Owner acceptance');
    if(currentChangeId && JSON.stringify(current.accepted_baseline || null)!==JSON.stringify(acceptedBaseline || null))throw new Error('Builder changed the accepted baseline');
    if(acceptanceReceiptHash && createHash('sha256').update(readFileSync(inside(root,acceptedBaseline.receipt))).digest('hex')!==acceptanceReceiptHash)throw new Error('Builder changed Owner acceptance history');
  }
  return {change_id:id,status:event.status,summary:event.summary,owner_result:event.owner_result||'',receipt:event.receipt||`receipts/${id}.md`,result_commit:event.result_commit||'',needs_codex:event.status==='NEEDS_CODEX'};
}
export async function pipeWorker(root,id) {
  if(!/^C\d{3,}$/.test(id)) throw new Error('Invalid Change ID');
  const config=readJson(root,'.ai/runtime.json');
  const cardPath=`changes/active/${id}.md`, card=readFileSync(inside(root,cardPath),'utf8');
  if(!config.pi_cli || !config.provider_extension) throw new Error('Missing local PI configuration');
  const runId=randomUUID(), runDir=inside(root,`.ai/runs/${id}-${runId}`);
  mkdirSync(runDir,{recursive:true});
  for(const folder of ['.ai/outbox','.ai/inbox']) mkdirSync(inside(root,folder),{recursive:true});
  const workPath=`.ai/work/${id}.json`, decisionPath=`.ai/work/${id}.decision.json`, outboxPath=`.ai/outbox/${id}.json`;
  let work=readJson(root,workPath);
  if(work) validateWorking(work,id);
  else writeJson(root,workPath,{change_id:id,goal:card.match(/## CHANGE\s+([^#]+)/)?.[1].trim().slice(0,500)||`执行 ${id} 的已授权合同`,done:[],now:'等待 Builder 读取仓库事实',next:['读取当前合同和事实后施工'],verify:[`按 ${cardPath} 的 VERIFY 检查`],blocked:null,watch_out:null,updated_at:timestamp()});
  const beforeCurrent=readJson(root,'results/CURRENT.json');
  const beforeAccepted=beforeCurrent?.accepted, beforeChangeId=beforeCurrent?.currentChange?.id;
  const acceptedBaseline=beforeCurrent?.accepted_baseline;
  const acceptanceContext={accepted:beforeAccepted,currentChangeId:beforeChangeId,acceptedBaseline,
    acceptanceReceiptHash:acceptedBaseline?.receipt?createHash('sha256').update(readFileSync(inside(root,acceptedBaseline.receipt))).digest('hex'):null};
  const beforeCandidates=beforeCurrent?.candidates?.map(c=>({id:c.id,accepted:c.accepted}));
  const runtime={change_id:id,run_id:runId,pid:process.pid,status:'running',model:`${config.provider}/${config.model}`,started_at:timestamp(),last_activity_at:null,current_action:'读取项目事实',changed_files:[],soft_stop_supported:true,compaction_count:0,token:randomUUID(),session_id:null};
  let active=null, stopRequested=false, stopTask=null, terminal=null, home=null;
  let lastProjectionWrite=0, lastFilesScan=0;
  function saveRuntime() {
    if(Date.now()-lastFilesScan>1500) { runtime.changed_files=changedFiles(root); lastFilesScan=Date.now(); }
    writeJson(root,'.ai/runs/current.json',runtime); lastProjectionWrite=Date.now();
  }
  function event(e) {
    if(e.type==='response') return;
    runtime.last_activity_at=timestamp();
    if(e.type==='tool_execution_start') runtime.current_action=({read:'读取文件',edit:'修改文件',write:'保存文件',powershell:'运行检查',bash:'运行检查',grep:'查找依据',find:'查找文件',ls:'查看目录'})[e.toolName] || '执行工具';
    if(e.type==='tool_execution_start' && ['read','write','edit'].includes(e.toolName) && e.args?.path) {
      // File names only; shell arguments and raw tool text may contain secrets.
      runtime.current_action += ' · '+String(e.args.path).split(/[\\/]/).slice(-2).join('/').slice(0,120);
    }
    if(e.type==='compaction_end' && e.result) runtime.compaction_count++;
    if(e.type!=='message_update' || Date.now()-lastProjectionWrite>500) saveRuntime();
  }
  async function stop() {
    if(stopRequested) return; stopRequested=true; runtime.status='stopping'; runtime.current_action='正在温和停止'; saveRuntime();
    stopTask=(async()=>{
      try {
        if(active && !active.closed) await active.abort();
        const checkpoint=validateWorking(readJson(root,workPath),id);
        writeJson(root,workPath,{...checkpoint,now:'Owner 主动停止；从仓库与本状态恢复',watch_out:checkpoint.watch_out||'恢复前核对实际 Git 修改与验证，不假定被中断的步骤已经完成。',updated_at:timestamp()});
        runtime.status='stopped'; runtime.current_action='已停止，工作状态保留';
      } catch(e) {
        runtime.status='stop_failed'; runtime.current_action='温和停止失败，已结束失控进程';
        active?.child.kill();
        terminal={change_id:id,status:'FAILED',summary:'温和停止机制失败，需要检查运行环境。',receipt:`receipts/${id}.md`};
      }
      saveRuntime();
    })();
  }
  try {
    rmSync(inside(root,outboxPath),{force:true});
    // A previously filtered Owner decision must be resolved in the card before launch.
    const pending=readJson(root,'.ai/needs-me.json');
    if(pending && pending.change_id!==id) throw new Error('Another Change has a pending Owner decision');
    if(pending?.change_id===id) throw new Error('Resolve Owner decision through Codex before resuming');
    const homeOptions={onStop:()=>void stop(),health:()=>({run_id:runId,pid:process.pid})};
    try { home=await startHome(root,{...homeOptions,port:config.home_port || 8763}); }
    catch(e) { if(e.code!=='EADDRINUSE') throw e; home=await startHome(root,{...homeOptions,port:0}); }
    runtime.endpoint=home.url; saveRuntime();
    // Browser pages opened from disk may discover the worker without a permanent server.
    writeJson(root,`.ai/jobs/${id}-${runId}.json`,{change_id:id,pid:process.pid,started_at:runtime.started_at,project_root:root,state:'RUNNING',run_id:runId});
    for(let pass=0;pass<4 && !stopRequested;pass++) {
      active=new PiRpc(root,config,join(runDir,`builder-${pass}`),{onEvent:event});
      runtime.session_id=active.sessionId; runtime.status='running'; runtime.current_action='全新 Builder 读取恢复状态'; saveRuntime();
      const prompt=`Execute only Change ${id}. First read AGENTS.md, BUILDER_CONTRACT.md, EVENT_PROTOCOL.md, ${cardPath}, ${workPath}, relevant WANT IDs, and actual git/diff. Never read previous sessions or old chats. Update ${workPath} at meaningful boundaries and BEFORE long tools or a decision candidate. Resume from actual files, not assumptions. If product ambiguity remains, write ${decisionPath} (change_id, question, why_blocked, options:string[], attempted_local_resolution, local_attempts), checkpoint and exit WITHOUT terminal event; Pipe will filter it. Do NOT directly write .ai/needs-me.json or OWNER_DECISION. Ordinary success: verify, commit ONLY intended changes, write/commit receipts/${id}.md, write exactly one ${outboxPath}, then stop. RESULT_READY is not Owner acceptance. Never create another Change.\nGate resolution if any: ${readJson(root,workPath)?.gate_resolution || 'none'}`;
      await active.run(prompt);
      await active.close(); const providerError=active.error; active=null;
      if(stopRequested) { if(stopTask) await stopTask; break; }
      if(providerError) throw new Error('PI provider/tool run did not complete: '+providerError);
      const candidate=readJson(root,decisionPath);
      if(candidate) {
        runtime.status='gate'; runtime.current_action='过滤决策候选'; saveRuntime();
        const decision=await runGate(root,id,config,runDir,{onSession:rpc=>{active=rpc;},onEvent:event,shouldStop:()=>stopRequested});
        if(stopRequested) { if(stopTask) await stopTask; break; }
        rmSync(inside(root,decisionPath),{force:true}); rmSync(inside(root,outboxPath),{force:true});
        if(decision.decision==='CONTINUE') {
          const latest=readJson(root,workPath); writeJson(root,workPath,{...latest,gate_resolution:decision.resolution,blocked:null,updated_at:timestamp()}); continue;
        }
        if(decision.decision==='NEEDS_ME') {
          writeJson(root,'.ai/needs-me.json',{change_id:id,question:decision.question,why_owner:candidate.why_blocked,options:decision.options.map((label,index)=>({id:String(index+1),label,artifact:null})),created_at:timestamp()});
          terminal={change_id:id,status:'OWNER_DECISION',summary:decision.question,owner_result:'results/index.html',receipt:`receipts/${id}.md`};
        } else terminal={change_id:id,status:'NEEDS_CODEX',summary:decision.reason,owner_result:'results/index.html',receipt:`receipts/${id}.md`};
        break;
      }
      terminal=readJson(root,outboxPath);
      if(terminal?.status==='OWNER_DECISION') throw new Error('Builder bypassed Owner Gate');
      terminal=validateTerminal(root,id,terminal,acceptanceContext);
      if(terminal.status==='RESULT_READY') {
        const current=readJson(root,'results/CURRENT.json');
        if(!beforeChangeId || current.currentChange?.id===beforeChangeId)for(const c of beforeCandidates || []) if(current.candidates?.find(v=>v.id===c.id)?.accepted!==c.accepted) throw new Error('Builder changed candidate acceptance');
        if(/^https?:\/\//.test(terminal.owner_result)) {
          const response=await fetch(terminal.owner_result,{signal:AbortSignal.timeout(10000)}); if(!response.ok) throw new Error('Owner result URL unavailable');
        }
        refreshProjection(root);
      }
      break;
    }
    if(!terminal && !stopRequested) terminal={change_id:id,status:'NEEDS_CODEX',summary:'决策候选反复返回，需要针对性诊断，已停止循环。',owner_result:'results/index.html',receipt:`receipts/${id}.md`};
  } catch(e) {
    if(stopRequested && stopTask) await stopTask;
    else terminal={change_id:id,status:'FAILED',summary:String(e.message).slice(0,450),receipt:`receipts/${id}.md`};
  } finally {
    if(active) await active.close();
    if(stopTask) await stopTask;
    if(terminal) {
      terminal=validateTerminal(root,id,terminal);
      writeJson(root,outboxPath,terminal); writeJson(root,`.ai/inbox/${Date.now()}-${id}.json`,terminal); writeJson(root,'.ai/inbox/LATEST.json',terminal);
      runtime.status='finished'; runtime.current_action=terminal.status;
    } else if(stopRequested && runtime.status==='stopping') runtime.status='stopped';
    runtime.soft_stop_supported=false; runtime.finished_at=timestamp(); saveRuntime();
    writeJson(root,`.ai/jobs/${id}-${runId}.json`,{change_id:id,pid:process.pid,state:runtime.status.toUpperCase(),run_id:runId,finished_at:runtime.finished_at});
    writeJson(root,join(runDir,'exit.json'),{change_id:id,run_id:runId,state:runtime.status,terminal:terminal?.status||null,session_id:runtime.session_id,finished_at:runtime.finished_at});
    if(home) { home.server.closeIdleConnections?.(); await new Promise(resolve=>home.server.close(resolve)); }
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { await pipeWorker(resolve(process.argv[2]),process.argv[3]); } catch(e) { console.error(e.message);process.exitCode=1; }
}
