/* Existing state projection and native Stop request; no worker launcher or second protocol. */
(() => {
  'use strict';
  const M=window.ENE_MODEL,config=M.bundle.config,params=new URLSearchParams(location.search);
  const profile=config.profiles.find(p=>p.id===params.get('p'))||config.profiles.find(p=>p.id===config.default_profile)||config.profiles[0];
  const {escape:e,link}=M;
  let state=window.ENE_STATE||{},live=false,refreshTask=null;
  let stopPending=false,stopRequested=null,stopMessage='';
  const subscribers=[];
  const page=document.body.dataset.page;
  const pageUrl=name=>name+'?p='+encodeURIComponent(profile.id);
  const stamp=v=>{const d=new Date(v);return v&&Number.isFinite(+d)?d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}):'未提供';};
  function work(){
    const run=state.runtime||state.last_run,alive=live&&state.runtime===run&&run?.alive===true;
    const known=live&&['stopped','finished','failed','stop_failed'].includes(run?.status);
    const label=alive?run.status==='stopping'?'停止中':'运行中':known?({stopped:'已停止',finished:'已结束',failed:'异常',stop_failed:'停止异常'}[run.status]):live&&!run?'空闲':'未知';
    if(stopRequested&&(run?.run_id!==stopRequested||known)){
      if(known&&run.run_id===stopRequested)stopMessage=run.status==='stopped'?'已确认停止。进度和工作记录仍保留。':'后台已退出；实际状态以当前记录为准。';
      stopRequested=null;
    }
    document.getElementById('work-label').textContent='工作 · '+label;
    const canStop=profile.source==='ene'&&M.http&&live&&alive&&run.soft_stop_supported===true&&run.run_id&&run.token;
    const end=alive?Date.now():Date.parse(run?.finished_at||run?.last_activity_at),start=Date.parse(run?.started_at);
    const duration=Number.isFinite(end)&&Number.isFinite(start)?Math.max(0,Math.floor((end-start)/1000)):null;
    const receipt=run?.change_id?M.bundle.documents?.find(d=>d.path==='receipts/'+run.change_id+'.md'):null;
    const need=state.needs_me;
    const needMarkup=need?`<div class="work-notice"><strong>需要你的决定${live?'':' · 保存的记录，连接后确认'}</strong><p>${e(need.question)}</p><ul>${(need.options||[]).map(option=>`<li>${e(option.label)} ${option.artifact?link(M.rootPath(option.artifact),'查看方案 ↗'):''}</li>`).join('')}</ul><p class="work-help">把选择告诉 Discussion；这里不自动批准施工。</p></div>`:'';
    const stopControl=canStop?`<button data-stop-run ${stopPending||stopRequested===run.run_id||run.status==='stopping'?'disabled':''}>${stopPending||stopRequested===run.run_id||run.status==='stopping'?'停止请求处理中':'停止后台工作'}</button>`:'';
    const markup=`<div class="work-topline"><strong>${e(run?.change_id||'后台工作')} · ${e(label)}</strong><span class="badge ${known&&run.status==='stopped'?'completed':''}">${run?'保留最近一次记录':'尚无后台记录'}</span></div><p class="work-help">${live?e(run?.current_action||'没有可确认的活跃工作。'):'连接不可用，仅显示保存的记录，不依据它判断进程存活。'}</p>${run?`<div class="work-times"><span>开始 ${e(stamp(run.started_at))}</span><span>最近活动 ${e(stamp(run.last_activity_at))}</span>${run.finished_at?`<span>结束 ${e(stamp(run.finished_at))}</span>`:''}${duration===null?'':`<span>本次运行 ${Math.floor(duration/60)}分 ${duration%60}秒</span>`}</div><details class="work-files" data-work-files><summary>${(run.changed_files||[]).length} 个 PI 已记录修改文件</summary><pre>${e((run.changed_files||[]).join('\n')||'没有已记录的修改。')}</pre></details>`:''}<p class="work-help">${run?.status==='stopped'?'已保存的进度仍在。需要继续时告诉 Discussion，不会因停止自动接受作品。':run?.status==='finished'?'后台结束与作品接受分别记录；查看回执后由你判断。':'停止请求只作用于这项施工，不负责关闭作品后端或 Home 查看服务。'}</p><div class="work-actions">${stopControl}${receipt?link(M.docPath(receipt.path),'查看 '+run.change_id+' 当前回执 ↗'):''}</div>${stopMessage?`<p class="work-help" role="status">${e(stopMessage)}</p>`:''}${profile.example?'<p class="work-help">此处显示 ENE 的真实施工记录，并非示例项目在运行。</p>':''}<p class="work-help">${e(config.roles?.current_work||'')} · Discussion ${e(config.roles?.discussion?.label||'未配置')}</p>${needMarkup}`;
    for(const id of ['recent-work-details','work-details']){
      const target=document.getElementById(id);if(!target)continue;
      const open=target.querySelector('[data-work-files]')?.open;
      const jump=id==='work-details'?(page==='wants'?'<p><a href="#recent-work" data-work-jump>查看后台工作卡 ↓</a></p>':link(pageUrl('index.html')+'#recent-work','查看后台工作卡 ↗')):'';
      const body=markup+jump;
      if(target.dataset.rendered!==body){target.innerHTML=body;target.dataset.rendered=body;if(open)target.querySelector('[data-work-files]')?.setAttribute('open','');}
    }
    document.getElementById('connection').textContent=live?'本地文件投影':M.http?'连接不可用 · 上次保存的投影':'离线投影 · 运行与历史需要本机服务';
  }
  document.getElementById('page-nav').innerHTML=[['index.html','愿望','wants'],['compare.html','对比','compare'],['materials.html','项目资料','materials']].map(([url,label,id])=>`<a href="${pageUrl(url)}" ${page===id?'aria-current="page"':''}>${label}</a>`).join('');
  const chooser=document.getElementById('project-choice');
  chooser.innerHTML=config.profiles.map(p=>`<option value="${e(p.id)}" ${p.id===profile.id?'selected':''}>${e(p.label)}</option>`).join('');
  chooser.addEventListener('change',()=>{location.href=location.pathname.split('/').pop()+'?p='+encodeURIComponent(chooser.value);});
  const example=document.getElementById('example-note');
  if(example){example.hidden=!profile.example;example.textContent='插槽示例 · 非真实项目，没有创建故事或关系工程。';}
  window.ENE_VIEW={profile,pageUrl,stamp,getState:()=>state,subscribe:fn=>subscribers.push(fn)};
  function refresh(){
    if(!M.http)return Promise.resolve();
    if(refreshTask)return refreshTask;
    refreshTask=(async()=>{
    try{
      const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw Error('Unavailable');
      const next=await response.json();if(!next.want||!next.current)throw Error('Incomplete');
      if(next.project_id!==window.ENE_STATE?.project_id)throw Error('Different project');
      const changed=JSON.stringify([state.want,state.current,state.history,state.acceptances])!==JSON.stringify([next.want,next.current,next.history,next.acceptances]);
      state=next;live=true;work();if(changed)subscribers.forEach(fn=>fn());
    }catch{live=false;work();}
    })().finally(()=>{refreshTask=null;});
    return refreshTask;
  }
  document.addEventListener('click',async ev=>{
    if(ev.target.closest('[data-work-jump]'))document.querySelector('.work-popover')?.removeAttribute('open');
    const button=ev.target.closest('[data-stop-run]');if(!button||button.disabled||stopPending)return;
    const observed=state.runtime;
    if(profile.source!=='ene'||!live||!observed?.alive||!observed.soft_stop_supported||!observed.token)return;
    stopPending=true;stopMessage='正在确认当前工作并请求停止。';work();
    try{
      // Refresh before sending; never control a replacement run using stale identity.
      await refresh();const run=state.runtime;
      if(live&&run?.run_id===observed.run_id&&!run.alive){stopMessage='当前工作已退出，无需再停止。';return;}
      if(!live||run?.run_id!==observed.run_id||!run?.alive||!run.soft_stop_supported||!run.token)throw Error('No matching live run');
      const response=await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:run.run_id,token:run.token}),signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw Error('Stop not accepted');
      stopRequested=run.run_id;stopMessage='已请求停止，等待确认实际退出；工作记录会保留。';
    }catch{stopMessage='停止请求未确认送达，记录仍保留；请告诉 Discussion 检查当前工作。';}
    finally{stopPending=false;await refresh();work();}
  });
  work();refresh();if(M.http)setInterval(()=>{if(document.visibilityState==='visible')refresh();},5000);
})();
