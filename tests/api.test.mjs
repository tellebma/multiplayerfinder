import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/index.js';
const room='10000000-0000-4000-8000-000000000001';
const member='20000000-0000-4000-8000-000000000001';
const valid={action:'vote',room,member,token:'a'.repeat(64),game:'3241660',vote:'yes'};
async function request(body,headers={},method='POST',route='room'){
  let result;const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){result={status:this.code,data,headers:this.headers};return this;}};
  await handler({url:`/api/${route}`,query:{route},method,headers:{host:'jvfinder.test',...headers},body},res);return result;
}
test('invalid credentials and cross-origin writes are rejected before DB access',async()=>{
  assert.equal((await request({...valid,token:'short'})).status,400);
  assert.equal((await request({...valid,room:'not-a-room'})).status,400);
  assert.equal((await request(valid,{origin:'https://evil.test'})).status,403);
  assert.equal((await request(valid,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await request({...valid,game:'invented'})).status,400);
  assert.equal((await request({...valid,vote:'maybe'})).status,400);
  assert.equal((await request({...valid,action:'join',name:'a'.repeat(31)})).status,400);
  assert.equal((await request(valid,{},'GET')).status,405);
});
test('server only sends token hashes to Supabase; secrets never returned',async()=>{
  let sent;
  const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;sent={body:JSON.parse(text),headers:req.headers};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({room,members:[],votes:{},matches:[]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  process.env.SUPABASE_URL=`http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-secret';
  try{
    const result=await request(valid);
    assert.equal(result.status,200);
    assert.equal(sent.body.p_token_hash.length,64);
    assert.notEqual(sent.body.p_token_hash,valid.token);
    assert.equal(sent.body.p_token,undefined);
    assert.equal(sent.headers.apikey,'test-only-secret');
    assert.ok(!JSON.stringify(result).includes('test-only-secret'));
    assert.equal(result.headers['Cache-Control'],'private, no-store');
  }finally{server.close();delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;}
});
test('cloud setup is reported accurately when configuration is missing',async()=>{
  delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await request(null,{},'GET','health')).data.configured,false);
  assert.equal((await request(valid)).status,503);
  const result=await request(null,{},'GET','games');
  assert.equal(result.status,200);assert.equal(result.data.games.length,27);
});
