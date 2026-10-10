/* Input/output presentation of existing facts. Selection/filtering never writes them. */
(() => {
  'use strict';
  const M=window.ENE_MODEL,V=window.ENE_VIEW,{profile,pageUrl,stamp}=V,{escape:e,link,docPath}=M;
  const $=id=>document.getElementById(id);
  const prefs={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};
  const key='ene-c010-want-'+profile.id;
  const savedSort=prefs.get(key+'-sort');
  const ui={selected:new URLSearchParams(location.search).get('want')||prefs.get(key),state:'all',search:'',change:'',sort:['new','old','updated'].includes(savedSort)?savedSort:'new',result:null};
  const clamp=value=>Number.isFinite(Number(value))?Math.max(14,Math.min(26,Number(value))):16;
  const defaultReading=clamp(M.bundle.config.presentation?.reading_size||16);
  let reading=clamp(prefs.get(key+'-reading')||defaultReading);
  function readSize(){document.body.style.setProperty('--reading-size',reading+'px');$('reading-value').textContent=reading+'px';$('reading-less').disabled=reading<=14;$('reading-more').disabled=reading>=26;}
  readSize();
  const detailsOpen=M.bundle.config.presentation?.details_open!==false?'open':'';
  let model;
  const title=w=>profile.want_titles?.[w.id]||w.text;
  const stateLabel=s=>({active:'有效',completed:'已完成',deferred:'暂缓',rejected:'不采纳',open:'待澄清'}[s]||'未记录');
  const wishLabel=w=>stateLabel(w.state);
  const saved=w=>profile.source==='ene'?M.bundle.first_saved?.[w.id]:null;
  const date=w=>Number.isFinite(Date.parse(w.created_at))?{time:w.created_at,kind:'创建'}:saved(w)?{time:saved(w).time,kind:'保存'}:null;
  const dateLabel=w=>{const d=date(w);return d?(d.kind==='保存'?'首次保存':'创建')+' '+stamp(d.time):'日期未记录';};
  const taskTitle=id=>profile.task_titles?.[id]||model.results.find(r=>r.id===id)?.title||M.bundle.documents?.find(d=>['changes/active/'+id+'.md','changes/done/'+id+'.md'].includes(d.path))?.title?.replace(/^C\d+\s*[—·-]\s*/,'')||id;
  function context(){
    const q=ui.search.trim().toLocaleLowerCase();
    const task=ui.change.trim().toLocaleLowerCase();
    return model.wants.filter(w=>(!task||(w.change_ids||[]).some(id=>[id,taskTitle(id)].join(' ').toLocaleLowerCase().includes(task)||(/^\d+$/.test(task)&&Number(id.match(/\d+$/)?.[0])===Number(task))))&&(!q||[w.id,w.text,w.note,title(w)].join(' ').toLocaleLowerCase().includes(q)));
  }
  function filters(){
    const wants=context();
    $('state-tabs').innerHTML=['all',...['active','completed','deferred','rejected','open'].filter(s=>model.wants.some(w=>w.state===s))].map(s=>`<button data-state="${e(s)}" aria-pressed="${s===ui.state}">${s==='all'?'全部':e(stateLabel(s))}<small>${s==='all'?wants.length:wants.filter(w=>w.state===s).length}</small></button>`).join('');
    $('change-suggestions').innerHTML=[...new Set(model.wants.flatMap(w=>w.change_ids||[]))].map(id=>`<option value="${e(id)}" label="${e(taskTitle(id))}"></option>`).join('');
    $('want-sort').value=ui.sort;
  }
  function list(resetScroll=false){
    const scroll=$('want-scroll'),top=resetScroll?0:scroll.scrollTop;
    filters();
    const wants=context().filter(w=>ui.state==='all'||w.state===ui.state);
    const ordinal=w=>saved(w)?.order??model.wants.indexOf(w);
    const updated=w=>Number.isFinite(Date.parse(w.updated_at))?Date.parse(w.updated_at):0;
    wants.sort((a,b)=>{
      if(ui.sort==='updated')return updated(b)-updated(a)||ordinal(b)-ordinal(a);
      const at=date(a)?.time,bt=date(b)?.time;
      if(!!at!==!!bt)return at?-1:1;
      const sequence=(at&&bt?Date.parse(at)-Date.parse(bt):0)||ordinal(a)-ordinal(b);
      return ui.sort==='old'?sequence:-sequence;
    });
    $('sort-note').textContent=ui.sort==='updated'?'按最近一次更新排列。':profile.source==='ene'?'按创建时间排列；旧愿望未记创建时间，采用 Git 最早可查保存，同次保存按原记录顺序。':'按已有创建时间排列；示例未记录日期，沿用内容中的先后顺序。';
    if(!wants.some(w=>w.id===ui.selected)){ui.selected=wants[0]?.id||null;ui.result=null;}
    const visible=wants;
    $('want-count').textContent=model.wants.length+' 条记录';
    $('filter-count').textContent='符合筛选 '+wants.length+' 条 · 全部已列入卡片区';
    $('want-list').innerHTML=visible.length?visible.map(w=>`<button class="wish-node ${w.id===ui.selected?'selected':''}" data-want="${e(w.id)}" aria-pressed="${w.id===ui.selected}"><span class="node-dot"></span><span class="wish-title">${e(title(w))}</span><span class="wish-date">${e(dateLabel(w))}</span><span class="wish-meta">${e(w.id)}<span class="badge ${e(w.state)}">${e(wishLabel(w))}</span></span></button>`).join(''):'<p class="empty">没有符合筛选的愿望，可以清除筛选。</p>';
    scroll.scrollTop=top;
    if(ui.selected)prefs.set(key,ui.selected);
    response();
  }
  function response(){
    const w=model.wants.find(w=>w.id===ui.selected);
    if(!w){$('intent').innerHTML='';$('result-axis').innerHTML='';$('response-count').textContent='';$('delivery').innerHTML='<div class="panel empty">选择一个愿望，查看它的回应。</div>';return;}
    const ids=w.change_ids||[],results=model.results.filter(r=>ids.includes(r.id));
    if(!results.some(r=>r.id===ui.result))ui.result=results[0]?.id||null;
    const source=w.source?.ref||w.source?.source_ref;
    $('intent').innerHTML=`<div class="flow-stem" aria-hidden="true"></div><div class="intent-content"><div class="intent-caption"><span class="eyebrow">输入 · ${e(w.id)}</span><span class="badge ${e(w.state)}">${e(wishLabel(w))}</span></div><h2>${e(title(w))}</h2><details ${detailsOpen}><summary>完整愿望、处理说明与来源</summary><p class="original">${e(w.text)}</p>${w.note?`<p>${e(w.note)}</p>`:''}<p class="quiet">${w.applies_to==='project'?'已记录范围：整个本项目。':'其他生效范围仅按已有记录解释，不从任务编号推断。'} ${source?link(docPath(source),'查看确认依据'):'历史原话/批准来源未完整记录。'}</p><p class="quiet">关联任务：${e(ids.join('、')||'未记录')} · 更新 ${e(stamp(w.updated_at))}</p></details><span class="intent-help">修改愿望请告诉 Discussion；本页只筛选、切换和查看。</span></div>`;
    $('response-count').textContent=results.length?'找到 '+results.length+' 项已有交付':'尚未记录可判断的交付';
    const recorded=date(w),first=saved(w),dateLine=document.createElement('p');
    dateLine.className='quiet';
    dateLine.textContent=recorded?.kind==='创建'?'创建：'+stamp(recorded.time):first?'创建时间未记录；Git 最早可查保存：'+stamp(first.time)+' · '+first.commit.slice(0,7):'创建/首次保存时间未记录。';
    $('intent').querySelector('details').append(dateLine);
    $('result-axis').innerHTML=results.map(r=>`<button class="result-node ${r.id===ui.result?'selected':''}" data-result="${e(r.id)}" aria-pressed="${r.id===ui.result}"><span class="node-dot"></span><strong>${e(r.id)}</strong><span>${e(r.title)}</span><small>${e(M.resultStates[r.status]||'未记录')}</small></button>`).join('');
    const r=results.find(r=>r.id===ui.result);
    $('delivery').innerHTML=r?delivery(r):'<div class="panel empty">这个愿望尚无已记录的成果关联。没有记录的方案或第一稿，不补造节点。</div>';
  }
  function delivery(r){
    const assessment=r.assessment?.items?.filter(x=>x.want_id===ui.selected).map(x=>`<p>${e(x.summary)} <span class="quiet">${e(x.status)}</span></p>`).join('')||(typeof r.assessment==='string'?`<p>${e(r.assessment)}</p>`:'');
    const content=typeof r.text==='string'?`<div class="delivered-text">${e(r.text)}</div>`:r.href?'<div class="artifact-placeholder"><span class="artifact-symbol" aria-hidden="true">↗</span><p>这份交付有独立作品页面。</p><span class="quiet">打开后按原页面正常显示，也可以放入对比。</span></div>':`<p class="quiet">${r.status==='preview'?'这份交付是当前首页预览。':'接受记录存在，独立版本入口尚缺。'}</p>`;
    return `<article class="panel delivery-card"><div class="result-header"><span class="eyebrow">输出 · ${e(r.id)}</span><span class="badge ${e(r.status)}">${e(M.resultStates[r.status]||'未记录')}</span></div><h2>${e(r.title)}</h2><p class="result-summary">${e(r.summary||'')}</p>${r.baseline?`<p class="baseline">已接受基线 ${e(r.baseline)} · 此候选需单独判断</p>`:''}${content}<details ${detailsOpen} class="review-details"><summary>回应、验收点与已有记录</summary>${assessment||'<p>施工者没有留下针对这条愿望的单独自评；可查看已有回执。</p>'}${r.checks?.length?'<ul>'+r.checks.map(c=>`<li>${e(c)}</li>`).join('')+'</ul>':''}${r.acceptance?`<p>Owner 接受：${e(r.acceptance.owner_text)} · ${e(stamp(r.acceptance.recorded_at))}</p>`:''}<p class="source-line">来源：${e(r.source||'明确标记的示例')}</p>${r.receipt?link(docPath(r.receipt),'查看施工回执 ↗'):''}</details><div class="delivery-actions">${r.href?link(r.href,'打开交付 ↗','button'):''}${r.compare?link(pageUrl('compare.html')+'&b='+encodeURIComponent(r.id),'放入对比 ↗','button secondary'):''}${!r.compare?'<span class="quiet">此记录没有可放入对比的作品入口。</span>':''}</div></article>`;
  }
  function mount(){model=M.build(V.getState(),profile);$('project-title').textContent=profile.example?profile.title:'我的愿望，交付了什么。';document.querySelector('.input-lane h2').textContent=profile.modules?.find(m=>m.type==='wants')?.title||'我的愿望';document.querySelector('.output-lane h2').textContent=profile.modules?.find(m=>m.type==='results')?.title||'这个愿望的回应';filters();list();}
  $('state-tabs').addEventListener('click',ev=>{const b=ev.target.closest('[data-state]');if(b){ui.state=b.dataset.state;list(true);}});
  $('want-search').addEventListener('input',ev=>{ui.search=ev.target.value;list(true);});
  $('change-filter').addEventListener('input',ev=>{ui.change=ev.target.value;list(true);});
  $('want-sort').addEventListener('change',ev=>{ui.sort=ev.target.value;ui.selected=ui.result=null;prefs.set(key+'-sort',ui.sort);list(true);});
  for(const [id,step] of [['reading-less',-2],['reading-more',2],['reading-reset',0]])$(id).addEventListener('click',()=>{reading=step?clamp(reading+step):defaultReading;readSize();prefs.set(key+'-reading',String(reading));});
  $('clear-filters').addEventListener('click',()=>{ui.state='all';ui.change=ui.search='';$('want-search').value=$('change-filter').value='';list(true);});
  $('want-list').addEventListener('click',ev=>{const b=ev.target.closest('[data-want]');if(b){ui.selected=b.dataset.want;ui.result=null;list();}});
  $('result-axis').addEventListener('click',ev=>{const b=ev.target.closest('[data-result]');if(b){ui.result=b.dataset.result;response();}});
  V.subscribe(mount);mount();
})();
