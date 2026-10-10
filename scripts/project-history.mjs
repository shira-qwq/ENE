import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inside } from './project-state.mjs';

const cache=new Map();
export function historicalResult(root,id) {
  // Explicit frozen results, from their receipts; never accept arbitrary refs.
  if(!['C003','C004','C007'].includes(id)) throw new Error('History result not exposed');
  const receipt=inside(root,`receipts/${id}.md`), modified=statSync(receipt).mtimeMs;
  const key=root+id, cached=cache.get(key);
  if(cached?.modified===modified)return cached.result;
  const text=readFileSync(receipt,'utf8');
  const section=text.match(/## RESULT COMMIT\s+([\s\S]*?)(?=\n## |$)/)?.[1];
  const commit=section?.match(/\b[a-f\d]{40}\b/)?.[0];
  if(!commit)throw new Error('No recorded result commit');
  // Clean public exports retain selected artifact snapshots under named Git tags.
  // The original receipt keeps the source commit; no local history is rewritten.
  let resolvedCommit=commit;
  try {execFileSync('git',['-C',root,'cat-file','-e',`${commit}:results/CURRENT.json`],{windowsHide:true,stdio:'ignore'});}
  catch {resolvedCommit=execFileSync('git',['-C',root,'rev-parse',`refs/tags/ene-artifact-${id}^{commit}`],{encoding:'utf8',windowsHide:true}).trim();}
  const current=JSON.parse(execFileSync('git',['-C',root,'show',`${resolvedCommit}:results/CURRENT.json`],{encoding:'utf8',windowsHide:true}));
  const artifact=current.artifact?.target || current.candidates?.[0]?.path;
  if(!artifact?.startsWith('prototypes/') || artifact.includes('..'))throw new Error('Invalid historical artifact');
  const result={id,commit:resolvedCommit,source_commit:commit,artifact,title:current.currentChange?.title || id,receipt:`receipts/${id}.md`,contract:current.currentChange?.contract || `changes/active/${id}.md`};
  cache.set(key,{modified,result});return result;
}
export function historyProjection(root) {
  return ['C003','C004','C007'].flatMap(id=>{try{return [historicalResult(root,id)];}catch{return [];}});
}
export function historicalFile(root,id,path) {
  const result=historicalResult(root,id), prefix=result.artifact.slice(0,result.artifact.lastIndexOf('/')+1);
  if((!path.startsWith(prefix) && path!=='results/index.html') || path.includes('..') || path.split('/').some(part=>part.startsWith('.')))throw new Error('Not a historical public artifact');
  return execFileSync('git',['-C',root,'show',`${result.commit}:${path}`],{windowsHide:true,maxBuffer:20*1024*1024});
}
