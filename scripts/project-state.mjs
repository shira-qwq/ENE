import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { historyProjection } from './project-history.mjs';

export const timestamp = () => new Date().toISOString();
export function inside(root, path) {
  const full = resolve(root, path), rel = relative(resolve(root), full);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + '\\')) throw new Error('Path outside project');
  return full;
}
export function readJson(root, path, fallback = null) {
  const file = inside(root, path);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
export function writeJson(root, path, value) {
  const file = inside(root, path);
  mkdirSync(dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    // Windows readers/scanners may briefly deny replacement. Keep snapshots atomic;
    // retry the same temp file for at most 1.41s, never truncate the live state.
    const delays = [10,20,40,80,160,200,200,200,200,200];
    for (let attempt=0;;attempt++) {
      try { renameSync(temp, file); break; }
      catch (error) {
        if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt>=delays.length) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delays[attempt]);
      }
    }
  } finally {
    // A permanent failure leaves the previous canonical snapshot intact.
    if (existsSync(temp)) { try { unlinkSync(temp); } catch {} }
  }
}
export function validateWant(want) {
  if (want?.version !== 1 || !Array.isArray(want.items)) throw new Error('Invalid WANT');
  const ids = new Set();
  for (const item of want.items) {
    if (!item.id || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim() ||
        !['active','open','deferred','rejected','completed'].includes(item.state) || !Number.isFinite(Date.parse(item.updated_at)) ||
        (item.responsibility!=null && !['Owner','Codex','PI'].includes(item.responsibility)) ||
        (item.owner_accepted!=null && typeof item.owner_accepted!=='boolean') ||
        (item.change_ids!=null && (!Array.isArray(item.change_ids) || item.change_ids.some(id=>!/^C\d{3,}$/.test(id))))) throw new Error('Invalid WANT item');
    ids.add(item.id);
  }
  return want;
}
export function projectState(root) {
  const last=readJson(root,'.ai/runs/current.json');
  const lastRun=last && ['stopped','finished','stop_failed'].includes(last.status)?{
    change_id:last.change_id,status:last.status,current_action:last.current_action,started_at:last.started_at,
    finished_at:last.finished_at,last_activity_at:last.last_activity_at,changed_files:last.changed_files || [],alive:false,soft_stop_supported:false
  }:null;
  return { project_id:createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0,16), home_url:`http://127.0.0.1:${readJson(root,'.ai/runtime.json',{})?.home_port || 8763}`, current: readJson(root, 'results/CURRENT.json'), want: validateWant(readJson(root, 'WANT.json')),
    needs_me: readJson(root, '.ai/needs-me.json'), runtime: null, last_run:lastRun, history:historyProjection(root), acceptances:ownerAcceptances(root) };
}
export function ownerAcceptances(root) {
  const folder=inside(root,'receipts');if(!existsSync(folder))return [];
  return readdirSync(folder).filter(file=>/^C\d{3,}\.md$/.test(file)).flatMap(file=>{
    const text=readFileSync(inside(root,'receipts/'+file),'utf8');
    return [...text.matchAll(/<!-- ENE_OWNER_ACCEPTANCE (.+?) -->/g)].flatMap(match=>{
      try {const record=JSON.parse(match[1]);return record.change_id===file.slice(0,-3) && /^[a-f\d]{40}$/.test(record.result_commit) && Number.isFinite(Date.parse(record.recorded_at))?[{...record,receipt:'receipts/'+file}]:[];}catch{return [];}
    });
  }).sort((a,b)=>Date.parse(b.recorded_at)-Date.parse(a.recorded_at));
}
export function refreshProjection(root) {
  const state = projectState(root);
  state.needs_me = null; // transient decisions are served from their canonical file only
  state.last_run = null; // local runtime history is not a tracked project fact
  const json = JSON.stringify(state).replace(/</g, '\\u003c');
  const projection = '// Generated from CURRENT + WANT. Edit canonical JSON, then --refresh.\nwindow.ENE_STATE=' + json + ';\n';
  writeFileSync(inside(root, 'results/project-state.js'), projection);
  return createHash('sha256').update(projection).digest('hex');
}
export function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim(); }
export function changedFiles(root) {
  const raw = execFileSync('git', ['-C',root,'status','--porcelain=v1','-z','--untracked-files=all'], { encoding:'utf8',windowsHide:true });
  const records = raw.split('\0'), result = [];
  for (let i=0;i<records.length;i++) {
    if (!records[i]) continue;
    const status = records[i].slice(0,2), file = records[i].slice(3);
    result.push(file);
    if (/[RC]/.test(status)) i++;
  }
  return result;
}
export function validateWorking(state, id) {
  if (state?.change_id !== id || typeof state.goal !== 'string' || !state.goal.trim() || typeof state.now !== 'string' ||
      !['done','next','verify'].every(k => Array.isArray(state[k]) && state[k].every(v => typeof v === 'string')) ||
      JSON.stringify(state).length > 16000) throw new Error('Invalid or oversized Working State');
  return state;
}
export function relevantWant(root, card) {
  const items = validateWant(readJson(root,'WANT.json')).items;
  const ids = new Set(card.match(/\bW-\d+\b/g) || []);
  return items.filter(i => ids.has(i.id));
}
export async function liveRuntime(root) {
  const run = readJson(root, '.ai/runs/current.json');
  if (!run || !['running','stopping','gate'].includes(run.status)) return null;
  try {
    process.kill(run.pid, 0);
    const url = new URL(run.endpoint);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Invalid runtime endpoint');
    const response = await fetch(url + 'api/health', { signal: AbortSignal.timeout(1200) });
    const health = await response.json();
    if (health.run_id !== run.run_id || health.pid !== run.pid) throw new Error('Stale process identity');
    return { ...run, changed_files: changedFiles(root), alive: true };
  } catch { return { ...run, status:'dead', alive:false, soft_stop_supported:false, token:undefined }; }
}
