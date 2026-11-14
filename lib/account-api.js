import { ApiError,rpc } from './database.js';
import { hash,randomToken,cookies,cookie,cookieName,sessionHash,loginUrl,verifyAssertion,steamPlayer,steamFriends,accountState,safeReturn,appOrigin } from './steam.js';

const send=(res,status,data)=>{res.setHeader('Cache-Control','private, no-store');return res.status(status).json(data);};
const redirect=(res,to)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Location',to);res.statusCode=302;res.end();};
function sameOrigin(req){if(req.headers['sec-fetch-site']==='cross-site')return false;try{return !req.headers.origin||new URL(req.headers.origin).host===req.headers.host;}catch{return false;}}
function cleanPreferences(input,games){const valid=new Set(games.map(g=>g.id));return Object.fromEntries(Object.entries(input||{}).filter(([id,v])=>valid.has(id)&&['yes','super','no'].includes(v)));}
export function cleanFilters(input={}){
  const result={};
  if(Number.isInteger(input.players)&&input.players>=2&&input.players<=16)result.players=input.players;
  if(['all','online','local'].includes(input.mode))result.mode=input.mode;
  if(Number.isFinite(input.budget)&&input.budget>=0&&input.budget<=60)result.budget=input.budget;
  if([0,30,60].includes(input.duration))result.duration=input.duration;
  for(const k of ['mods','narrative','strict','available','personalized'])if(typeof input[k]==='boolean')result[k]=input[k];
  if(Array.isArray(input.genres)&&input.genres.length<=20)result.genres=input.genres.filter(s=>typeof s==='string'&&s.length<=40);
  return result;
}
export async function accountApi(req,res,route,catalog){
  try{
    const u=new URL(req.url,appOrigin());
    if(route==='auth/steam/login'&&req.method==='GET'){
      const state=randomToken();res.setHeader('Set-Cookie',[cookie('jvf-steam-state',state,600),cookie('jvf-steam-return',safeReturn(u.searchParams.get('returnTo')),600)]);return redirect(res,loginUrl(state));
    }
    if(route==='auth/steam/callback'&&req.method==='GET'){
      const c=cookies(req),state=u.searchParams.get('state');
      if(u.searchParams.get('openid.mode')==='cancel'){res.setHeader('Set-Cookie',[cookie('jvf-steam-state','',0),cookie('jvf-steam-return','',0)]);return redirect(res,safeReturn(c['jvf-steam-return'])+'#steam=cancelled');}
      const {steamId,nonce}=await verifyAssertion(u.searchParams,state,c['jvf-steam-state']);
      const profile=await steamPlayer(steamId),token=randomToken();
      await rpc('jvf_steam_login',{p_steam_id:steamId,p_name:profile.name,p_avatar:profile.avatar,p_session_hash:hash(token),p_nonce_hash:hash(nonce)});
      res.setHeader('Set-Cookie',[cookie(cookieName(),token,30*24*3600),cookie('jvf-steam-state','',0),cookie('jvf-steam-return','',0)]);
      return redirect(res,safeReturn(c['jvf-steam-return'])+'#steam=connected');
    }
    if(route==='account'&&req.method==='GET'){
      const account=await accountState(req);return send(res,200,{account,friendsConfigured:!!process.env.STEAM_WEB_API_KEY});
    }
    if(route==='steam/friends'&&req.method==='GET'){
      const account=await accountState(req);if(!account)throw new ApiError('Connectez-vous à Steam pour voir vos amis.',401,'LOGIN_REQUIRED');
      return send(res,200,await steamFriends(account.profile.steamId));
    }
    if(route!=='account'&&route!=='steam/invite')return send(res,404,{error:'Route inconnue.'});
    if(req.method!=='POST')return send(res,405,{error:'Méthode non autorisée.'});
    if(!sameOrigin(req))throw new ApiError('Origine non autorisée.',403,'INVALID_ORIGIN');
    let b=req.body;if(typeof b==='string'){try{b=JSON.parse(b);}catch{throw new ApiError('Requête invalide.');}}
    if(!b||typeof b!=='object'||JSON.stringify(b).length>16000)throw new ApiError('Requête invalide.');
    const session=sessionHash(req);if(!session)throw new ApiError('Connectez-vous à Steam pour continuer.',401,'LOGIN_REQUIRED');
    if(route==='steam/invite'){
      const account=await accountState(req);if(!account)throw new ApiError('Connectez-vous à Steam pour continuer.',401,'LOGIN_REQUIRED');
      if(!/^[a-f0-9-]{36}$/.test(b.room||'')||!Array.isArray(b.steamIds)||b.steamIds.length<1||b.steamIds.length>4)throw new ApiError('Choisissez de 1 à 4 amis.');
      const list=await steamFriends(account.profile.steamId);const allowed=new Set(list.friends.map(f=>f.steamId));
      if(!b.steamIds.every(id=>allowed.has(id)))throw new ApiError('Sélectionnez uniquement des amis de votre liste Steam.',403,'NOT_A_FRIEND');
      const data=await rpc('jvf_account_command',{p_session_hash:session,p_action:'invite',p_data:{room:b.room,steamIds:[...new Set(b.steamIds)]}});return send(res,200,data);
    }
    if(!['logout','vote','filters','link','import'].includes(b.action))throw new ApiError('Action inconnue.');
    const data={};
    if(b.action==='vote'){
      if(!(await catalog()).games.some(g=>g.id===b.game)||!['yes','super','no','clear'].includes(b.vote))throw new ApiError('Vote invalide.');
      data.game=b.game;data.vote=b.vote;
    }
    if(b.action==='filters')data.filters=cleanFilters(b.filters);
    if(['import','link'].includes(b.action))data.preferences=cleanPreferences(b.preferences,(await catalog()).games);
    if(b.action==='link'){
      if(!/^[a-f0-9-]{36}$/.test(b.room||'')||!/^[a-f0-9-]{36}$/.test(b.member||'')||!/^[a-f0-9]{64}$/.test(b.token||''))throw new ApiError('Votre ancien accès au salon est invalide.');
      Object.assign(data,{room:b.room,member:b.member,tokenHash:hash(b.token)});
    }
    const result=await rpc('jvf_account_command',{p_session_hash:session,p_action:b.action,p_data:data});
    if(b.action==='logout')res.setHeader('Set-Cookie',cookie(cookieName(),'',0));
    return send(res,200,result);
  }catch(e){
    if(route==='auth/steam/callback'){
      console.error('Steam login rejected',e.code||e.name);res.setHeader('Set-Cookie',[cookie('jvf-steam-state','',0),cookie('jvf-steam-return','',0)]);return redirect(res,'/#steam=error');
    }
    if(!(e instanceof ApiError))console.error('Account request failed',e.name);
    return send(res,e.status||502,{error:e instanceof ApiError?e.message:'Steam est momentanément indisponible.',code:e.code||'STEAM_UNAVAILABLE'});
  }
}
