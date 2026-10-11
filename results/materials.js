/* Directory and previews generated from existing local documents, not a new ledger. */
(() => {
  'use strict';
  const M=window.ENE_MODEL,{escape:e,docPath,link}=M;
  const $=id=>document.getElementById(id),documents=M.bundle.documents||[];
  const names={current:'最近相关',rules:'项目约定与冻结',history:'历史任务与回执'};
  $('material-list').innerHTML=Object.entries(names).map(([group,title])=>{
    const items=documents.filter(d=>d.group===group);
    return `<section class="material-group"><h2>${e(title)} <span class="quiet">${items.length} 份已有文件</span></h2><div class="panel">${items.map(d=>`<div class="document-row"><div><strong>${e(d.title)}</strong><span class="document-path">${e(d.path)}</span></div><button data-document="${e(d.path)}">阅读</button>${/^(changes\/(active|done)\/C\d{3,}|receipts\/(C\d{3,}|V1_1-ACCEPTANCE|V1_1-SCOPE))\.md$/.test(d.path)||['V1_1_INTEGRATION_REPORT.md','README.md','ENE_BASE_V1_FREEZE.md','docs/ENE_PARADIGM.md','results/README.md'].includes(d.path)?link(docPath(d.path),'单独打开 ↗'):''}</div>`).join('')}</div></section>`;
  }).join('');
  function openDocument(path){
    const document=documents.find(d=>d.path===path);if(!document)return;
    $('file-title').textContent=document.title;$('file-body').textContent=document.text;$('file-preview').hidden=false;$('file-preview').scrollIntoView({block:'start'});
  }
  $('material-list').addEventListener('click',ev=>{
    const button=ev.target.closest('[data-document]');if(!button)return;
    openDocument(button.dataset.document);
  });
  $('close-file').addEventListener('click',()=>{$('file-preview').hidden=true;});
  const requested=new URLSearchParams(location.search).get('doc');
  if(requested)openDocument(requested);
})();
