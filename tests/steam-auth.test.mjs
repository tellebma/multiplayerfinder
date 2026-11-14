import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENID,STEAM_OPENID,callbackUrl,validateAssertion,verifyAssertion,loginUrl,safeReturn,cookie,cookieName,sessionHash,hash,steamFriends } from '../lib/steam.js';
import { cleanFilters } from '../lib/account-api.js';
const state='a'.repeat(64),steamId='76561198000000001';
function assertion(){return new URLSearchParams({state,'openid.ns':OPENID,'openid.mode':'id_res','openid.op_endpoint':STEAM_OPENID,'openid.claimed_id':`https://steamcommunity.com/openid/id/${steamId}`,'openid.identity':`https://steamcommunity.com/openid/id/${steamId}`,'openid.return_to':callbackUrl(state),'openid.response_nonce':new Date().toISOString().replace(/\.\d{3}Z$/,'Z')+'steam-random','openid.assoc_handle':'test-association','openid.signed':'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle','openid.sig':'provider-signature'});}
test('login uses Steam OpenID with a canonical callback, realm and random state',()=>{
  const u=new URL(loginUrl(state));assert.equal(u.origin,'https://steamcommunity.com');assert.equal(u.searchParams.get('openid.return_to'),callbackUrl(state));assert.equal(u.searchParams.get('openid.mode'),'checkid_setup');
});
test('OpenID identity is accepted only after Steam verifies its signature',async()=>{
  let sent;const verified=await verifyAssertion(assertion(),state,state,async(url,options)=>{sent={url,options};return {ok:true,text:async()=>`ns:${OPENID}\nis_valid:true\n`};});
  assert.equal(verified.steamId,steamId);assert.equal(sent.url,STEAM_OPENID);assert.equal(new URLSearchParams(sent.options.body).get('openid.mode'),'check_authentication');
  await assert.rejects(verifyAssertion(assertion(),state,state,async()=>({ok:true,text:async()=>`is_valid:false\n`})),/validé/);
});
test('state mismatch, foreign identity/provider, unsigned return URL and nonce expiry are rejected',()=>{
  assert.throws(()=>validateAssertion(assertion(),state,'b'.repeat(64)),/expiré/);
  for(const [key,value] of [['openid.claimed_id','https://evil.test/openid/id/'+steamId],['openid.identity','https://steamcommunity.com/openid/id/76561198000000002'],['openid.op_endpoint','https://evil.test/'],['openid.return_to','https://evil.test/'],['openid.signed','claimed_id,identity'],['openid.response_nonce','2000-01-01T00:00:00Zold']]){const p=assertion();p.set(key,value);assert.throws(()=>validateAssertion(p,state,state),key);}
  const duplicate=assertion();duplicate.append('openid.identity','forged');assert.throws(()=>validateAssertion(duplicate,state,state),/ambiguë/);
});
test('redirects and account filter inputs cannot introduce external destinations or arbitrary keys',()=>{
  for(const input of ['https://evil.test/','//evil.test/','/\\evil.test/','/api/account','/\nLocation: bad'])assert.equal(safeReturn(input),'/');
  assert.equal(safeReturn('/?salon=10000000-0000-4000-8000-000000000001'),'/?salon=10000000-0000-4000-8000-000000000001');
  assert.deepEqual(cleanFilters({players:99,mode:'evil',budget:-1,genres:['FPS'],personalized:true,admin:true}),{genres:['FPS'],personalized:true});
});
test('session cookies are HttpOnly, scoped to the host and never expose the raw session in RPC hashes',()=>{
  const raw='c'.repeat(64);const text=cookie(cookieName(),raw,3600);assert.match(text,/HttpOnly/);assert.match(text,/SameSite=Lax/);assert.match(text,/Secure/);assert.ok(!text.includes('Domain='));
  assert.equal(sessionHash({headers:{cookie:`${cookieName()}=${raw}`}}),hash(raw));assert.notEqual(hash(raw),raw);
});
test('friends distinguish missing configuration, private lists and public profiles without leaking the API key',async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.STEAM_WEB_API_KEY;
  try{
    delete process.env.STEAM_WEB_API_KEY;assert.equal((await steamFriends(steamId)).configured,false);
    process.env.STEAM_WEB_API_KEY='only-a-test-key';
    globalThis.fetch=async()=>({status:401});assert.equal((await steamFriends(steamId)).private,true);
    globalThis.fetch=async url=>String(url).includes('GetFriendList')?{ok:true,json:async()=>({friendslist:{friends:[{steamid:'76561198000000002'}]}})}:{ok:true,json:async()=>({response:{players:[{steamid:'76561198000000002',personaname:'Friend',personastate:1,avatarmedium:'https://avatars.steamstatic.com/test.jpg'}]}})};
    const data=await steamFriends(steamId);assert.equal(data.friends[0].name,'Friend');assert.equal(data.friends[0].online,true);assert.ok(!JSON.stringify(data).includes('only-a-test-key'));
  }finally{globalThis.fetch=originalFetch;if(originalKey)process.env.STEAM_WEB_API_KEY=originalKey;else delete process.env.STEAM_WEB_API_KEY;}
});
