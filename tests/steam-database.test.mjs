import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const container=process.env.JVF_TEST_DB;
function sql(s){const r=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-tA'],{input:s,encoding:'utf8'});return {ok:r.status===0,text:r.stdout.trim(),error:r.stderr};}
const room='60000000-0000-4000-8000-000000000001',room2='60000000-0000-4000-8000-000000000002',member='70000000-0000-4000-8000-000000000001',other='70000000-0000-4000-8000-000000000002';
const h='a'.repeat(64),s='b'.repeat(64),s2='c'.repeat(64),nonce='d'.repeat(64),sid='76561198000000001';
const command=(action,data={})=>`select public.jvf_account_command('${s}','${action}','${JSON.stringify(data)}'::jsonb);`;
test('Steam linking preserves votes, restores a room on another device, seeds a new lobby and revokes sessions',{skip:!container},()=>{
  sql(`delete from public.jvf_rooms where id in ('${room}','${room2}');delete from public.jvf_profiles where steam_id='${sid}';delete from public.jvf_steam_nonces where nonce_hash='${nonce}';`);
  let r=sql(`select public.jvf_command('create','${room}','${member}','${h}','Guest',null,null);select public.jvf_command('vote','${room}','${member}','${h}','','730','super');`);assert.ok(r.ok,r.error);
  r=sql(`select public.jvf_steam_login('${sid}','Steam player','','${s}','${nonce}');`);assert.ok(r.ok,r.error);
  assert.match(sql(`select public.jvf_steam_login('${sid}','Steam player','','${s2}','${nonce}');`).error,/NONCE_REUSED/);
  r=sql(command('link',{room,member,tokenHash:h,preferences:{}}));assert.ok(r.ok,r.error);let data=JSON.parse(r.text);assert.equal(data.preferences['730'],'super');assert.equal(data.rooms[0].member,member);
  assert.match(sql(`select public.jvf_command('state','${room}','${member}','${h}');`).error,/STEAM_LOGIN_REQUIRED/);
  r=sql(`select public.jvf_account_room('${s}','state','${room}','${other}','${'e'.repeat(64)}');`);assert.ok(r.ok,r.error);assert.equal(JSON.parse(r.text).me,member);
  r=sql(command('vote',{game:'league-of-legends',vote:'yes'}));assert.ok(r.ok,r.error);
  r=sql(`select public.jvf_account_room('${s}','create','${room2}','${other}','${h}','Steam player');`);assert.ok(r.ok,r.error);data=JSON.parse(r.text);assert.equal(data.votes['730'],'super');assert.equal(data.votes['league-of-legends'],'yes');
  assert.equal(sql("set role anon; select * from public.jvf_profiles;").ok,false);
  assert.equal(sql(`set role anon; ${command('state')}`).ok,false);
  assert.ok(sql(command('logout')).ok);assert.match(sql(command('state')).error,/LOGIN_REQUIRED/);
  sql(`delete from public.jvf_rooms where id in ('${room}','${room2}');delete from public.jvf_profiles where steam_id='${sid}';delete from public.jvf_steam_nonces where nonce_hash='${nonce}';`);
});
