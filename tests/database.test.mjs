import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Explicitly opt in: JVF_TEST_DB=jvfinder-test-db npm test.
const container=process.env.JVF_TEST_DB;
function sql(s){const p=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-tA'],{input:s,encoding:'utf8'});return {ok:p.status===0,text:p.stdout.trim(),error:p.stderr};}
function command(action,i,game=null,vote=null,name=`Joueur ${i}`,token='a'.repeat(64)){
  const room='30000000-0000-4000-8000-000000000001',member=`40000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  return `select public.jvf_command('${action}','${room}','${member}','${token}','${name}',${game?`'${game}'`:'null'},${vote?`'${vote}'`:'null'});`;
}
test('five independent votes, isolation, retry safety, capacity and unanimous matches',{skip:!container},()=>{
  let r=sql(`delete from public.jvf_rooms where id='30000000-0000-4000-8000-000000000001';`);assert.ok(r.ok,r.error);
  assert.ok(sql(command('create',1)).ok);
  assert.ok(sql(command('create',1)).ok,'create retries must not consume a slot');
  assert.match(sql(command('join',2,null,null,'Joueur 1')).error,/NAME_TAKEN/);
  for(let i=2;i<=5;i++)assert.ok(sql(command('join',i)).ok);
  assert.match(sql(command('join',6)).error,/ROOM_FULL/);
  assert.match(sql(command('state',1,null,null,'x','b'.repeat(64))).error,/ACCESS_DENIED/);
  for(let i=1;i<=4;i++){
    const response=JSON.parse(sql(command('vote',i,'3241660','yes')).text);
    assert.deepEqual(response.matches,[],'four yes votes are insufficient');
  }
  let response=JSON.parse(sql(command('vote',5,'3241660','yes')).text);
  assert.deepEqual(response.matches,['3241660']);
  assert.equal(response.members.length,5);
  assert.deepEqual(response.votes,{'3241660':'yes'});
  assert.ok(!JSON.stringify(response).includes('token_hash'));
  assert.deepEqual(JSON.parse(sql(command('vote',3,'3241660','no')).text).matches,[]);
  assert.deepEqual(JSON.parse(sql(command('vote',3,'3241660','clear')).text).votes,{});
  assert.equal(sql("set role anon; select * from public.jvf_members;").ok,false);
  assert.equal(sql(`set role anon; ${command('state',1)}`).ok,false);
  assert.equal(sql(`set role authenticated; ${command('state',1)}`).ok,false);
  assert.equal(sql(`set role service_role; ${command('state',1)}`).ok,true);
  sql("delete from public.jvf_rooms where id='30000000-0000-4000-8000-000000000001';");
});
