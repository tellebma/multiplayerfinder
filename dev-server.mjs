import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import handler from './api/index.js';
try{process.loadEnvFile('.env.local');}catch{}
const root=resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));return res;};
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      req.query={route:url.pathname.slice(5)};
      let chunks='',size=0;
      for await(const chunk of req){size+=chunk.length;if(size>20000){res.status(413).json({error:'Requête trop grande.'});return;}chunks+=chunk;}
      if(chunks){try{req.body=JSON.parse(chunks);}catch{res.status(400).json({error:'JSON invalide.'});return;}}
      return await handler(req,res);
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+sep)){res.statusCode=403;res.end();return;}
    if(!(await stat(path)).isFile())throw Error('Not found');
    res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');
    res.end(await readFile(path));
  }catch{res.statusCode=404;res.end('Introuvable');}
});
const host=process.env.HOST||'0.0.0.0';
server.listen(Number(process.env.PORT)||8765,host,()=>{
  const port=server.address().port;
  console.log(`JVFinder: http://localhost:${port}`);
  if(host==='0.0.0.0')for(const addresses of Object.values(networkInterfaces())){
    for(const address of addresses||[])if(address.family==='IPv4'&&!address.internal&&!address.address.startsWith('169.254.'))console.log(`Réseau local: http://${address.address}:${port}`);
  }
});
