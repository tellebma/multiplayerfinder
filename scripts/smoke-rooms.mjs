import { randomUUID,randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import handler from '../api/index.js';
const base=process.argv[2];
if(!base){try{process.loadEnvFile('.env.local');}catch{}}
const room=randomUUID();
const members=Array.from({length:6},()=>({room,member:randomUUID(),token:randomBytes(32).toString('hex')}));
async function request(action,index,extra={}){
  const body={action,...members[index],...extra};
  if(base){const r=await fetch(new URL('/api/room',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  let result;
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){result={status:this.code,data};}};
  await handler({url:'/api/room',query:{route:'room'},method:'POST',headers:{host:'localhost'},body},res);
  return result;
}
try{
  for(let i=0;i<5;i++){const r=await request(i?'join':'create',i,{name:`Vérification ${i+1}`});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.members.length,i+1);}
  assert.equal((await request('join',5,{name:'Vérification 6'})).status,409);
  for(let i=0;i<4;i++){const r=await request('vote',i,{game:'2644470',vote:'yes'});assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(r.data.matches,[]);}
  assert.deepEqual((await request('vote',4,{game:'2644470',vote:'yes'})).data.matches,['2644470']);
  const state=await request('state',0);assert.deepEqual(state.data.votes,{'2644470':'yes'});assert.ok(!JSON.stringify(state.data).includes('token'));
  const old=members[0].token;members[0].token='0'.repeat(64);assert.equal((await request('state',0)).status,403);members[0].token=old;
  assert.deepEqual((await request('vote',4,{game:'2644470',vote:'no'})).data.matches,[]);
  console.log(JSON.stringify({room,checks:'5 members, unanimous match, changed vote, private votes, access protection, capacity limit: passed'}));
}catch(e){console.error(JSON.stringify({room,error:e.message}));process.exitCode=1;}
