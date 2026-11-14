import { createHash } from 'node:crypto';
import { catalog, searchSteam, importSteam, hasGame } from '../lib/game-library.js';
import { accountApi } from '../lib/account-api.js';
import { sessionHash } from '../lib/steam.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern=/^[0-9a-f]{64}$/;
const allowedActions=new Set(['create','join','state','vote']);
function send(res,status,data){res.setHeader('Cache-Control','private, no-store');return res.status(status).json(data);}
export default async function handler(req,res){
  const requestUrl=new URL(req.url,'http://localhost');
  const route=String(req.query?.route||requestUrl.searchParams.get('route')||requestUrl.pathname.replace(/^\/api\/?/,''));
  if(route==='account'||route.startsWith('auth/steam/')||route.startsWith('steam/'))return accountApi(req,res,route,catalog);
  if(route==='health'&&req.method==='GET')return send(res,200,{configured:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY)});
  if(['games','games/search','games/import'].includes(route)){
    try{
      if(route==='games'&&req.method==='GET')return send(res,200,await catalog());
      if(route==='games/search'&&req.method==='GET')return send(res,200,await searchSteam(requestUrl.searchParams.get('q')));
      if(route==='games/import'&&req.method==='POST'){
        if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host))return send(res,403,{error:'Origine non autorisée.'});
        let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return send(res,400,{error:'Requête invalide.'});}
        return send(res,200,{game:await importSteam(b?.id)});
      }
      return send(res,405,{error:'Méthode non autorisée.'});
    }catch(e){console.error('Game library request failed',e.name);return send(res,e.status||502,{error:e.status?e.message:'La bibliothèque est momentanément indisponible.'});}
  }
  if(route==='refresh')return send(res,405,{error:'Les données Steam sont actualisées par le script de maintenance du catalogue.'});
  if(route!=='room')return send(res,404,{error:'Route inconnue.'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Méthode non autorisée.'});}
  // Same-origin browser calls only; bearer tokens remain required independently.
  if(req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'Origine non autorisée.'});
  const origin=req.headers.origin;
  const host=req.headers.host;
  if(origin){try{if(new URL(origin).host!==host)return send(res,403,{error:'Origine non autorisée.'});}catch{return send(res,403,{error:'Origine invalide.'});}}
  let b=req.body;
  try{if(typeof b==='string')b=JSON.parse(b);}catch{return send(res,400,{error:'Requête invalide.'});}
  if(!b||JSON.stringify(b).length>4096)return send(res,400,{error:'Requête invalide.'});
  if(!allowedActions.has(b.action)||!uuid.test(b.room||'')||!uuid.test(b.member||'')||!tokenPattern.test(b.token||''))return send(res,400,{error:'Accès au salon invalide.'});
  const name=typeof b.name==='string'?b.name.trim().normalize('NFC'):'';
  if(['create','join'].includes(b.action)&&(!name||name.length>30||/[\u0000-\u001f\u007f]/.test(name)))return send(res,400,{error:'Indiquez un prénom entre 1 et 30 caractères.'});
  if(b.action==='vote'){
    if(!['yes','super','no','clear'].includes(b.vote))return send(res,400,{error:'Vote invalide.'});
    try{if(!await hasGame(String(b.game)))return send(res,400,{error:'Jeu inconnu.'});}catch{return send(res,502,{error:'La bibliothèque est momentanément indisponible.'});}
  }
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return send(res,503,{error:'Le salon sera disponible une fois Supabase configuré.',code:'NOT_CONFIGURED'});
  try{
    const accountSession=sessionHash(req);
    const response=await fetch(`${process.env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/${accountSession?'jvf_account_room':'jvf_command'}`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`},
      body:JSON.stringify({...(accountSession?{p_session_hash:accountSession}:{}),p_action:b.action,p_room:b.room,p_member:b.member,p_token_hash:createHash('sha256').update(b.token).digest('hex'),p_name:name,p_game:b.action==='vote'?String(b.game):null,p_vote:b.action==='vote'?b.vote:null}),
      signal:AbortSignal.timeout(20000)
    });
    const data=await response.json();
    if(!response.ok){
      const known={STEAM_LOGIN_REQUIRED:'Cette place est liée à Steam. Reconnectez-vous pour la retrouver.',LOGIN_REQUIRED:'Votre connexion Steam a expiré. Reconnectez-vous.',ROOM_FULL:'Le salon est complet : les 5 places sont prises.',NAME_TAKEN:'Ce prénom est déjà utilisé dans ce salon. Ajoutez une initiale.',ROOM_NOT_FOUND:'Ce salon est introuvable. Vérifiez le lien d’invitation.',ACCESS_DENIED:'Cet accès personnel ne correspond pas au salon.',INVALID_INPUT:'Les données du salon sont invalides.'};
      const key=Object.keys(known).find(k=>data.message?.includes(k));
      if(key)return send(res,key.includes('LOGIN_REQUIRED')?401:key==='ACCESS_DENIED'?403:key==='ROOM_NOT_FOUND'?404:409,{error:known[key],code:key});
      console.error('Supabase RPC error',data.code||'unknown');
      return send(res,502,{error:'La base du salon est indisponible. Réessayez dans un instant.'});
    }
    return send(res,200,data);
  }catch(error){console.error('Room request failed',error.name);return send(res,502,{error:'Impossible de joindre le salon. Vos choix précédents sont conservés.'});}
}
