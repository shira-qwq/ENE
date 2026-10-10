/* Two normal rendering windows. Only view preferences are stored locally. */
(() => {
  'use strict';
  const M=window.ENE_MODEL,V=window.ENE_VIEW,{profile}=V,{escape:e,link,docPath}=M;
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
  const prefs={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};
  const prefix='ene-c010-compare-'+profile.id;
  const ui={a:params.get('a')||prefs.get(prefix+'-a'),b:params.get('b')||prefs.get(prefix+'-b'),layout:prefs.get(prefix+'-layout')==='side'?'side':'stacked',ratio:50};
  let model,dragging=false;
  const choices=()=>model.results.filter(r=>r.compare);
  function pane(side){
    const r=choices().find(r=>r.id===ui[side]),shell=$('frame-'+side),open=$('open-'+side);
    if(!r){shell.innerHTML='<p class="empty">没有可打开的版本。</p>';open.hidden=true;$('meta-'+side).textContent='';return;}
    const signature=r.href||r.id+'\n'+r.text;
    if(shell.dataset.version!==signature){
      shell.innerHTML=r.href?`<iframe title="${side.toUpperCase()} 窗口 · ${e(r.title)}" src="${e(r.href)}"></iframe>`:`<div class="text-preview"><h2>${e(r.title)}</h2>${e(r.text)}</div>`;
      shell.dataset.version=signature;
    }
    open.hidden=!r.href;if(r.href)open.href=r.href;
    $('meta-'+side).textContent=(profile.example?'示例 · ':r.commit?'Git '+r.commit.slice(0,7)+' · ':'当前文件 · ')+(M.resultStates[r.status]||'未记录');
  }
  function render(){
    model=M.build(V.getState(),profile);
    const defaults=profile.compare_defaults||[];
    for(const side of ['a','b']){
      if(!choices().some(r=>r.id===ui[side]))ui[side]=choices().find(r=>r.id===defaults[side==='a'?0:1])?.id||choices()[0]?.id||null;
      $('version-'+side).innerHTML=choices().map(r=>`<option value="${e(r.id)}" ${r.id===ui[side]?'selected':''}>${e(r.id)} · ${e(r.title)}</option>`).join('');
      pane(side);prefs.set(prefix+'-'+side,ui[side]||'');
    }
    const url=new URL(location.href);url.searchParams.set('p',profile.id);url.searchParams.set('a',ui.a||'');url.searchParams.set('b',ui.b||'');history.replaceState(null,'',url);
    const noViewer=model.results.filter(r=>!r.compare&&r.status==='accepted');
    $('compare-notes').innerHTML=(profile.example?'<p>这里是明确标记的示例文本，用于观察同一外壳的内容插槽。</p>':'<p>C003/C004/C007 从 Git 保存版本读取；C008 与当前 Home 是当前文件。旧页文字保留当时状态，外层按真实接受记录说明。</p>')+'<p>仅查看，不切换工作区版本。关闭页面结束网页查看，不承诺停止后端实例。</p>'+noViewer.map(r=>`<p>${e(r.id)}：已有接受记录，缺少独立查看入口。${r.receipt?link(docPath(r.receipt),'查看回执'):''}</p>`).join('');
    layout();
  }
  function layout(){
    $('compare-body').dataset.layout=ui.layout;
    $('compare-body').style.setProperty('--split-a',ui.ratio+'fr');$('compare-body').style.setProperty('--split-b',(100-ui.ratio)+'fr');
    $('layout-toggle').textContent=ui.layout==='stacked'?'切为左右':'切为上下';
    $('splitter').setAttribute('aria-orientation',ui.layout==='stacked'?'horizontal':'vertical');$('splitter').setAttribute('aria-valuenow',String(Math.round(ui.ratio)));
  }
  for(const side of ['a','b'])$('version-'+side).addEventListener('change',ev=>{ui[side]=ev.target.value;render();});
  $('layout-toggle').addEventListener('click',()=>{ui.layout=ui.layout==='stacked'?'side':'stacked';prefs.set(prefix+'-layout',ui.layout);layout();});
  const splitter=$('splitter');
  splitter.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;dragging=true;splitter.setPointerCapture(ev.pointerId);$('compare-body').classList.add('dragging');ev.preventDefault();});
  splitter.addEventListener('pointermove',ev=>{
    if(!dragging)return;
    const bounds=$('compare-body').getBoundingClientRect();
    const fraction=ui.layout==='stacked'?(ev.clientY-bounds.top)/bounds.height:(ev.clientX-bounds.left)/bounds.width;
    ui.ratio=Math.max(20,Math.min(80,fraction*100));layout();
  });
  const end=()=>{dragging=false;$('compare-body').classList.remove('dragging');};
  splitter.addEventListener('pointerup',end);splitter.addEventListener('pointercancel',end);splitter.addEventListener('lostpointercapture',end);
  splitter.addEventListener('keydown',ev=>{if(['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Home'].includes(ev.key)){ev.preventDefault();ui.ratio=ev.key==='Home'?50:Math.max(20,Math.min(80,ui.ratio+(['ArrowUp','ArrowLeft'].includes(ev.key)?-5:5)));layout();}});
  V.subscribe(render);render();
})();
