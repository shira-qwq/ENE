/* Generic display model only. Project facts come from ENE_STATE; layout/data source from JSON.
   Shared by index (home) and compare.html. Never writes project facts. */
(() => {
  'use strict';
  const bundle = window.ENE_HOME_CONFIG || { config: { profiles: [] }, examples: {}, assessment: null };
  const http = location.protocol === 'http:' || location.protocol === 'https:';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = value => String(value ?? '').length > 35 ? String(value).slice(0, 34) + '…' : String(value ?? '');
  const rootPath = value => {
    const p = String(value ?? '');
    if (!p || p.startsWith('/') || /[\\?#]/.test(p) || p.split('/').some(s => s === '..' || s === '.') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
    return '../' + p.split('/').map(encodeURIComponent).join('/');
  };
  const docPath = value => {
    const p = rootPath(value);
    return p ? (http ? '/documents/' + String(value).split('/').map(encodeURIComponent).join('/') : p) : null;
  };
  const link = (href, label, classes = 'quiet') => href ? `<a class="${classes}" href="${escape(href)}" target="_blank" rel="noopener">${escape(label)}</a>` : '';
  const states = { active: '待回应', open: '待澄清', completed: '已完成', deferred: '暂缓', rejected: '不采纳' };
  const resultStates = { candidate: '候选 · 待你判断', accepted: '你已接受', historical: '历史版本', preview: '本轮首页 · 原型', example: '示例版本', rejected: '已退回' };

  function eneModel(state, profile) {
    const current = state.current || {};
    const accepted = state.acceptances || [];
    const history = state.history || [];
    const resultMap = new Map();
    if (current.currentChange && current.currentChange.id) {
      const id = current.currentChange.id;
      resultMap.set(id, {
        id,
        title: current.title || current.currentChange.title || id,
        summary: current.summary || '',
        status: current.accepted === true ? 'accepted' : current.accepted === false ? 'rejected' : 'candidate',
        href: rootPath(current.artifact && current.artifact.target),
        receipt: current.receipt,
        checks: current.owner_check || [],
        baseline: current.accepted_baseline && current.accepted_baseline.change_id,
        source: 'results/CURRENT.json'
      });
    }
    for (const old of history) {
      if (resultMap.has(old.id)) continue;
      const record = accepted.find(a => a.change_id === old.id);
      const path = rootPath(old.artifact);
      resultMap.set(old.id, {
        id: old.id,
        title: old.title || old.id,
        summary: (record && record.summary) || '保存在 Git 中的作品版本。',
        status: record ? 'accepted' : 'historical',
        href: http && path ? '/history/' + encodeURIComponent(old.id) + '/' + String(old.artifact).split('/').map(encodeURIComponent).join('/') : null,
        receipt: old.receipt,
        commit: old.commit,
        acceptance: record,
        source: old.receipt || 'Git 历史入口'
      });
    }
    for (const record of accepted) {
      if (resultMap.has(record.change_id)) continue;
      resultMap.set(record.change_id, {
        id: record.change_id,
        title: record.change_id,
        summary: record.summary,
        status: 'accepted',
        href: null,
        receipt: record.receipt,
        commit: record.result_commit,
        acceptance: record,
        source: record.receipt
      });
    }
    for (const result of resultMap.values()) {
      if (profile.result_titles && profile.result_titles[result.id]) result.title = profile.result_titles[result.id];
      if (profile.result_summaries && profile.result_summaries[result.id]) { result.fullSummary = result.summary; result.summary = profile.result_summaries[result.id]; }
      result.compare = !!result.href;
    }
    const results = Array.from(resultMap.values()).filter(r=>r.id!==profile.preview?.id);
    if (profile.preview) {const href=rootPath(profile.preview.target);results.unshift({ ...profile.preview, status: profile.preview.status || 'preview', href, compare: !!href, source: profile.preview.contract, assessment: bundle.assessment, acceptance: accepted.find(a=>a.change_id===profile.preview.id) });}
    return {
      wants: (state.want && state.want.items) || [],
      results,
      files: ['意图 → WANT.json', '当前作品 → results/CURRENT.json', '当前施工 → changes/active/', '当前接手状态 → .ai/work/', '本页配置 → results/home.config.json'],
      note: '运行 checkpoint 在本机；Git 保存已提交内容。换机器接手尚待正式交付验证。'
    };
  }

  function build(state, profile) {
    if (profile.source === 'ene') return eneModel(state || {}, profile);
    const model = structuredClone(bundle.examples[profile.source] || { wants: [], results: [] });
    for (const r of model.results) r.compare = !!r.text;
    return model;
  }

  window.ENE_MODEL = { bundle, http, escape, short, rootPath, docPath, link, states, resultStates, build };
})();
