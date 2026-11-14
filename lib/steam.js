import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { ApiError,rpc } from './database.js';
export const OPENID='http://specs.openid.net/auth/2.0';
export const STEAM_OPENID='https://steamcommunity.com/openid/login';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('hex');
export function appOrigin(){const u=new URL(process.env.APP_URL||'https://multiplayerfinder.vercel.app');if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw new Error('APP_URL must use HTTPS');return u.origin;}
export function cookies(req){const result={};for(const item of (req.headers.cookie||'').split(';')){const i=item.indexOf('=');if(i<0)continue;try{result[item.slice(0,i).trim()]=decodeURIComponent(item.slice(i+1));}catch{}}return result;}
export function cookieName(){return appOrigin().startsWith('https:')?'__Host-jvf-session':'jvf-session';}
export function sessionHash(req){const raw=cookies(req)[cookieName()];return /^[a-f0-9]{64}$/.test(raw||'')?hash(raw):null;}
export function cookie(name,value,seconds){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${appOrigin().startsWith('https:')?'; Secure':''}`;}
export function safeReturn(value){if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value))return '/';const u=new URL(value,appOrigin());if(u.origin!==appOrigin()||u.pathname!=='/')return '/';const room=u.searchParams.get('salon');return room&&/^[a-f0-9-]{36}$/.test(room)?`/?salon=${room}`:'/';}
export function callbackUrl(state){return `${appOrigin()}/api/auth/steam/callback?state=${state}`;}
export function loginUrl(state){const u=new URL(STEAM_OPENID);u.search=new URLSearchParams({'openid.ns':OPENID,'openid.mode':'checkid_setup','openid.return_to':callbackUrl(state),'openid.realm':`${appOrigin()}/`,'openid.identity':OPENID+'/identifier_select','openid.claimed_id':OPENID+'/identifier_select'});return u.href;}
export function validateAssertion(params,state,cookieState,now=Date.now()){
  if(!/^[a-f0-9]{64}$/.test(state||'')||!/^[a-f0-9]{64}$/.test(cookieState||'')||!timingSafeEqual(Buffer.from(state),Buffer.from(cookieState)))throw new ApiError('La connexion a expiré. Recommencez.',401,'INVALID_STATE');
  for(const key of new Set(params.keys()))if(params.getAll(key).length!==1)throw new ApiError('Réponse Steam ambiguë.',401,'INVALID_ASSERTION');
  const get=k=>params.get('openid.'+k);
  const steamId=/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(get('claimed_id')||'')?.[1];
  const signed=new Set((get('signed')||'').split(','));
  const required=['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle'];
  if(get('ns')!==OPENID||get('mode')!=='id_res'||!['https://steamcommunity.com/openid/login','https://steamcommunity.com/openid/'].includes(get('op_endpoint'))||!steamId||get('claimed_id')!==get('identity')||get('return_to')!==callbackUrl(state)||!required.every(k=>signed.has(k))||!get('sig'))throw new ApiError('La réponse de connexion Steam est invalide.',401,'INVALID_ASSERTION');
  const nonce=get('response_nonce')||'',date=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/.exec(nonce)?.[0];
  if(!date||Math.abs(now-Date.parse(date))>10*60*1000||nonce.length>255)throw new ApiError('La réponse Steam a expiré.',401,'EXPIRED_ASSERTION');
  return {steamId,nonce};
}
export async function verifyAssertion(params,state,cookieState,fetcher=fetch){
  const result=validateAssertion(params,state,cookieState);
  const body=new URLSearchParams();for(const [key,value] of params)if(key.startsWith('openid.'))body.set(key,value);body.set('openid.mode','check_authentication');
  const r=await fetcher(STEAM_OPENID,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),redirect:'error',signal:AbortSignal.timeout(12000)});
  const response=Object.fromEntries((await r.text()).trim().split(/\r?\n/).map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1)];}));
  if(!r.ok||response.is_valid!=='true')throw new ApiError('Steam n’a pas validé cette connexion.',401,'INVALID_SIGNATURE');
  return result;
}
function safeAvatar(value){try{const u=new URL(value);return u.protocol==='https:'&&(/(^|\.)steamstatic\.com$/.test(u.hostname)||/(^|\.)akamaihd\.net$/.test(u.hostname))?u.href:'';}catch{return '';}}
export async function steamPlayer(steamId){
  if(process.env.STEAM_WEB_API_KEY){try{const u=new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');u.search=new URLSearchParams({key:process.env.STEAM_WEB_API_KEY,steamids:steamId});const r=await fetch(u,{signal:AbortSignal.timeout(5000)});const p=(await r.json()).response?.players?.[0];if(p)return {name:String(p.personaname||'Joueur Steam').slice(0,30),avatar:safeAvatar(p.avatarfull||p.avatarmedium)};}catch{}}
  // Public profile metadata is enough to label an OpenID account without a Web API key.
  try{const r=await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`,{signal:AbortSignal.timeout(5000)});const xml=await r.text();const field=name=>new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`).exec(xml)?.[1];const name=field('steamID');if(r.ok&&name)return {name:name.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').slice(0,30),avatar:safeAvatar(field('avatarFull'))};}catch{}
  return {name:`Steam ${steamId.slice(-6)}`,avatar:''};
}
const friendCache=new Map();
export async function steamFriends(steamId){
  if(!process.env.STEAM_WEB_API_KEY)return {configured:false,friends:[]};
  const cached=friendCache.get(steamId);if(cached&&cached.expires>Date.now())return cached.data;
  const u=new URL('https://api.steampowered.com/ISteamUser/GetFriendList/v1/');u.search=new URLSearchParams({key:process.env.STEAM_WEB_API_KEY,steamid:steamId,relationship:'friend'});
  const r=await fetch(u,{signal:AbortSignal.timeout(8000)});
  if(r.status===401)return {configured:true,private:true,friends:[]};
  if(!r.ok)throw new ApiError('Steam ne permet pas de charger les amis pour le moment.',502,'STEAM_UNAVAILABLE');
  const ids=((await r.json()).friendslist?.friends||[]).map(f=>f.steamid).filter(id=>/^\d{17}$/.test(id));
  const selected=ids.slice(0,500),chunks=[];for(let i=0;i<selected.length;i+=100)chunks.push(selected.slice(i,i+100));
  const lists=await Promise.all(chunks.map(async batch=>{try{const url=new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');url.search=new URLSearchParams({key:process.env.STEAM_WEB_API_KEY,steamids:batch.join(',')});const response=await fetch(url,{signal:AbortSignal.timeout(6000)});const ps=(await response.json()).response?.players||[];return ps.map(p=>({steamId:p.steamid,name:String(p.personaname||'Joueur Steam').slice(0,80),avatar:safeAvatar(p.avatarmedium),online:!!p.personastate,profileUrl:`https://steamcommunity.com/profiles/${p.steamid}/`}));}catch{return batch.map(id=>({steamId:id,name:`Steam ${id.slice(-6)}`,avatar:'',online:false,profileUrl:`https://steamcommunity.com/profiles/${id}/`}));}}));
  const data={configured:true,friends:lists.flat().sort((a,b)=>Number(b.online)-Number(a.online)||a.name.localeCompare(b.name)),truncated:ids.length>500};
  if(friendCache.size>100)friendCache.delete(friendCache.keys().next().value);friendCache.set(steamId,{expires:Date.now()+120000,data});return data;
}
export async function accountState(req){const h=sessionHash(req);if(!h)return null;try{return await rpc('jvf_account_command',{p_session_hash:h,p_action:'state',p_data:{}});}catch(e){if(e.code==='LOGIN_REQUIRED')return null;throw e;}}
