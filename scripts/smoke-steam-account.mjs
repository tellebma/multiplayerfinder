// Uses the server credential to create a clearly synthetic SteamID fixture.
// The public login endpoint never accepts a SteamID supplied by the client.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { rpc } from '../lib/database.js';
import { hash,randomToken } from '../lib/steam.js';
try{process.loadEnvFile('.env.local');}catch{}
const base=process.argv[2];if(!base)throw Error('Provide a deployment URL');
const steamId='00000000000000000',room=randomUUID(),member=randomUUID(),guestToken=randomToken();
const cookieName=new URL(base).protocol==='https:'?'__Host-jvf-session':'jvf-session';
let token=randomToken();
async function login(){await rpc('jvf_steam_login',{p_steam_id:steamId,p_name:'JVF integration test',p_avatar:'',p_session_hash:hash(token),p_nonce_hash:hash(randomToken())});}
async function request(route,body,authenticated=true){const response=await fetch(new URL('/api/'+route,base),{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(authenticated?{Cookie:`${cookieName}=${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
try{
  await login();
  let r=await request('account');assert.equal(r.status,200);assert.equal(r.data.account.profile.steamId,steamId);
  r=await request('account',{action:'vote',game:'730',vote:'super'});assert.equal(r.status,200);assert.equal(r.data.preferences['730'],'super');
  r=await request('room',{action:'create',room,member,token:guestToken,name:'JVF integration test'});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.votes['730'],'super');
  token=randomToken();await login();
  r=await request('account');assert.ok(r.data.account.rooms.some(r=>r.room===room));
  r=await request('room',{action:'state',room,member:randomUUID(),token:randomToken()});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.me,member);
  r=await request('room',{action:'state',room,member,token:guestToken},false);assert.equal(r.status,401);assert.equal(r.data.code,'STEAM_LOGIN_REQUIRED');
  r=await request('steam/friends');assert.equal(r.status,200);
  r=await request('account',{action:'logout'});assert.equal(r.status,200);
  r=await request('account');assert.equal(r.data.account,null);
  console.log(JSON.stringify({room,steamId,checks:'account preferences, seeded room, cross-device recovery, guest-token rejection, friends state and logout passed'}));
}catch(e){console.error(JSON.stringify({room,steamId,error:e.message}));process.exitCode=1;}
