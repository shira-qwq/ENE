import { createServer } from 'node:http';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inside, projectState, liveRuntime, refreshProjection, readJson } from './project-state.mjs';
import { historicalFile, historicalResult } from './project-history.mjs';

export const publicDocument=path=>/^(?:changes\/(?:active|done)\/C\d{3,}\.md|receipts\/(?:C\d{3,}|V1_1-ACCEPTANCE|V1_1-SCOPE)\.md|V1_1_INTEGRATION_REPORT\.md|README\.md|ENE_BASE_V1_FREEZE\.md|docs\/ENE_PARADIGM\.md|results\/README\.md)$/.test(path);
const contentType=file=>({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.md':'text/plain','.pdf':'application/pdf'}[extname(file)] || 'application/octet-stream');
const htmlText=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export const projectId=root=>createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0,16);
export async function startHome(root,{port=8763, onStop, health}={}) {
  const server=createServer(async(req,res)=>{
    try {
      const address=server.address(), expected=`127.0.0.1:${address.port}`;
      if(req.headers.host!==expected) { res.writeHead(403); return res.end('Invalid host'); }
      const origin=req.headers.origin;
      if(origin && origin!=='null' && origin!==`http://${expected}`) { res.writeHead(403); return res.end('Invalid origin'); }
      if(origin==='null') res.setHeader('Access-Control-Allow-Origin','null');
      res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
      const url=new URL(req.url,`http://${expected}`);
      const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
      if(req.method==='OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods','GET, POST'); res.setHeader('Access-Control-Allow-Headers','Content-Type');
        res.writeHead(204); return res.end();
      }
      if(url.pathname==='/api/health' && req.method==='GET') return json(200,health?.() || {project_id:projectId(root)});
      if(url.pathname==='/api/state' && req.method==='GET') {
        const state=projectState(root); state.runtime=await liveRuntime(root); state.project_id=projectId(root);
        return json(200,state);
      }
      if(url.pathname==='/api/stop' && req.method==='POST') {
        let body=''; for await(const chunk of req) { body+=chunk; if(body.length>4096) return json(413,{error:'Request too large'}); }
        const input=JSON.parse(body), run=await liveRuntime(root);
        if(!run?.alive || input.run_id!==run.run_id || !input.token || input.token!==run.token) return json(409,{error:'No matching active run'});
        if(onStop) { onStop(); return json(202,{status:'stopping'}); }
        const forwarded=await fetch(run.endpoint+'api/stop',{method:'POST',body:JSON.stringify(input),headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(2500)});
        return json(forwarded.status,await forwarded.json());
      }
      if(req.method!=='GET' && req.method!=='HEAD') return json(405,{error:'Read-only surface'});
      let path=decodeURIComponent(url.pathname); if(path==='/') path='/results/index.html';
      if(path.startsWith('/documents/')) {
        const target=path.slice('/documents/'.length);
        if(!publicDocument(target))return json(404,{error:'Not a public document'});
        const file=inside(root,target);inside(realpathSync(root),realpathSync(file));
        // Ordinary browser-readable HTML avoids desktop download handling for .md.
        const text=readFileSync(file,'utf8');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        return res.end(req.method==='HEAD'?undefined:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlText(target)} · ENE</title><style>body{max-width:900px;margin:32px auto;padding:0 20px;font:16px/1.7 system-ui;background:#f7f8fa;color:#14171c}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#1b5fb0}</style><a href="/results/index.html">返回 Project Home</a><h1>施工记录</h1><p>${htmlText(target)} · 只读项目文件</p><pre>${htmlText(text)}</pre></html>`);
      }
      if(path.startsWith('/history/')) {
        const match=path.match(/^\/history\/(C\d{3,})\/(.+)$/);
        if(!match)return json(404,{error:'Unknown historical result'});
        try {
          // Old artifact "return Home" links return to the one current workbench.
          if(match[2]==='results/index.html') {
            historicalResult(root,match[1]);res.writeHead(302,{Location:'/results/index.html'});return res.end();
          }
          const bytes=historicalFile(root,match[1],match[2]);
          res.writeHead(200,{'Content-Type':contentType(match[2])+'; charset=utf-8'});
          return res.end(req.method==='HEAD'?undefined:bytes);
        } catch {return json(404,{error:'Historical artifact unavailable'});}
      }
      if(path.split('/').some(p=>p.startsWith('.')) || /^\/(?:scripts|tests|changes|receipts|templates|experiments|backend-v0-work|handoff|ene-|LOCAL_RESULT|REVIEW_RESULT)/.test(path)) return json(404,{error:'Not a public artifact'});
      const file=inside(root,path.slice(1)); inside(realpathSync(root),realpathSync(file));
      if(!statSync(file).isFile()) return json(404,{error:'File missing'});
      const mime=contentType(file);
      res.writeHead(200,{'Content-Type':mime+'; charset=utf-8'}); res.end(req.method==='HEAD'?undefined:readFileSync(file));
    } catch(e) { res.writeHead(e.code==='ENOENT'?404:400,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.code==='ENOENT'?'File missing':'Invalid request'})); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(process.argv[process.argv.indexOf('--root')+1] || '.');
  // --root is optional; do not interpret the executable name as a root.
  const selected=process.argv.includes('--root')?root:process.cwd();
  refreshProjection(selected);
  if(process.argv.includes('--serve')) {
    const config=readJson(selected,'.ai/runtime.json') || readJson(selected,'.ai/runtime.example.json',{});
    const home=await startHome(selected,{port:Number(config.home_port || 8763)});
    console.log('PROJECT_HOME '+home.url+'results/index.html');
    for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>home.server.close(()=>process.exit(0)));
  } else console.log('PROJECT_HOME_PROJECTION_REFRESHED');
}
