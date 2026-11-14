import { readFile } from 'node:fs/promises';
import { ApiError } from './database.js';

let curatedPromise, cached, pending;
const memo=new Map();
const curated=()=>curatedPromise??=readFile(new URL('../catalog.json',import.meta.url),'utf8').then(JSON.parse);
function credentials(){return {apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`};}
async function database(path,options={}){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new ApiError('La bibliothèque partagée est indisponible.',503);
  const r=await fetch(`${process.env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/jvf_game_library${path}`,{...options,headers:{...credentials(),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new ApiError('Impossible de charger ou sauvegarder la bibliothèque partagée.',502);
  const text=await r.text();return text?JSON.parse(text):null;
}
export function invalidateLibrary(){cached=null;}
export async function hasGame(id){
  if((await curated()).games.some(g=>g.id===id)||cached?.value.games.some(g=>g.id===id))return true;
  if(!/^[1-9]\d{0,9}$/.test(id)||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return false;
  // Bypass the list cache: an import may have hit another serverless instance.
  return (await database(`?id=eq.${id}&select=id`)).length>0;
}
export async function catalog(){
  const base=await curated();
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return base;
  if(cached&&Date.now()<cached.until)return cached.value;
  if(pending)return pending;
  pending=(async()=>{
    const rows=[];
    for(let offset=0;;offset+=1000){const page=await database(`?select=data&order=id&limit=1000&offset=${offset}`);rows.push(...page);if(page.length<1000)break;}
    const ids=new Set(base.games.map(g=>g.id));
    const value={...base,games:[...base.games,...rows.map(r=>r.data).filter(g=>!ids.has(g.id))]};
    cached={value,until:Date.now()+30000};return value;
  })();
  try{return await pending;}finally{pending=null;}
}
async function steamJson(path){
  const key=path,old=memo.get(key);if(old&&old.until>Date.now())return old.value;
  const r=await fetch(`https://store.steampowered.com/api/${path}`,{signal:AbortSignal.timeout(12000),headers:{'Accept':'application/json'}});
  if(!r.ok)throw new ApiError('Steam ne répond pas pour le moment. Réessayez un peu plus tard.',502);
  const value=await r.json();if(memo.size>=150)memo.delete(memo.keys().next().value);memo.set(key,{value,until:Date.now()+300000});return value;
}
export async function searchSteam(term){
  term=String(term||'').trim();if(term.length<2||term.length>80)throw new ApiError('Saisissez entre 2 et 80 caractères.');
  const d=await steamJson(`storesearch/?term=${encodeURIComponent(term)}&l=french&cc=fr`);
  return {source:'Steam',items:(d.items||[]).filter(i=>i.type==='app'&&Number.isSafeInteger(i.id)&&i.platforms?.windows).slice(0,20).map(i=>({id:String(i.id),name:i.name,image:i.tiny_image,price:i.price?.currency==='EUR'?i.price.final/100:null,source:`https://store.steampowered.com/app/${i.id}/`}))};
}
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function steamGame(d,id){
  if(d.type!=='game'||!d.platforms?.windows)throw new ApiError('Ce résultat n’est pas un jeu PC Windows.');
  const categories=new Set((d.categories||[]).map(c=>c.id));
  if(![1,9,20,24,27,36,37,38,39].some(id=>categories.has(id)))throw new ApiError('Steam ne signale pas de mode multijoueur pour ce jeu.');
  const modes=[];if([20,36,38].some(id=>categories.has(id)))modes.push('online');if([24,37,39].some(id=>categories.has(id)))modes.push('local');
  const price=d.price_overview,coop=[9,38,39].some(id=>categories.has(id));
  const genres=(d.genres||[]).map(g=>g.description);
  const genre=genres.includes('Strategy')||genres.includes('Stratégie')?'Stratégie':genres.includes('Simulation')?'Simulation':genres.includes('Adventure')||genres.includes('Aventure')?'Aventure':genres.includes('Sports')?'Sport':genres.includes('Racing')||genres.includes('Course')?'Course':genres.includes('RPG')?'RPG':'Action';
  return {id,appid:Number(id),name:plain(d.name).slice(0,200),genre,genres,minPlayers:null,maxPlayers:null,minutes:null,modes,kind:coop?'Coopération':'Multijoueur',original:false,external:true,uncertain:true,description:plain(d.short_description).slice(0,3000),note:'Import Steam : le multijoueur est signalé, mais le nombre de joueurs, la taille du groupe et la durée restent à confirmer. Ce jeu est exclu du filtre « compatibles uniquement ». Consultez la fiche officielle avant de choisir.',source:`https://store.steampowered.com/app/${id}/`,distribution:'Steam',price:d.is_free?0:price?.currency==='EUR'?price.final/100:null,discount:price?.discount_percent||0,image:d.header_image,poster:d.screenshots?.[0]?.path_full||d.header_image,movies:(d.movies||[]).slice(0,3),release:d.release_date,unreleased:!!d.release_date?.coming_soon,fetchedAt:new Date().toISOString()};
}
export async function importSteam(id){
  id=String(id||'');if(!/^[1-9]\d{0,9}$/.test(id))throw new ApiError('Identifiant Steam invalide.');
  const existing=(await catalog()).games.find(g=>g.id===id);if(existing)return existing;
  const response=await steamJson(`appdetails?appids=${id}&cc=fr&l=french`);
  if(!response[id]?.success)throw new ApiError('La fiche Steam est indisponible.');
  const game=steamGame(response[id].data,id);
  await database('?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id,data:game})});
  invalidateLibrary();return game;
}
