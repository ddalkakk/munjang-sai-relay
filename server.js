import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import handler from './api/room.js';

const port = Number(process.env.PORT || 4284);
const url = 'http://127.0.0.1:' + port;
const files = {'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
function openBrowser() {
  if (process.argv.includes('--open') && process.platform === 'win32') {
    spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore'}).unref();
  }
}
const server = http.createServer(async (req,res) => {
  const path = new URL(req.url,url).pathname;
  if (path === '/api/room') return handler(req,res);
  if (!Object.hasOwn(files,path)) { res.writeHead(404); return res.end(); }
  try {
    const body = await readFile(new URL('./public/'+files[path],import.meta.url));
    res.setHeader('Content-Type',({'/':'text/html','/app.js':'application/javascript','/style.css':'text/css'})[path]+'; charset=utf-8');
    res.setHeader('X-Relay-App','between-lines');
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.on('error',async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const r = await fetch(url,{signal:AbortSignal.timeout(2000)});
      if (r.ok && r.headers.get('x-relay-app') === 'between-lines') {
        console.log('이미 실행 중인 집필실 · '+url);
        openBrowser();
        return;
      }
    } catch {}
  }
  console.error('서버 실행 실패',error.message);
  process.exitCode=1;
});
server.listen(port,'0.0.0.0',()=>{console.log('문장 사이 · '+url);openBrowser()});
