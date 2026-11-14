export class ApiError extends Error {
  constructor(message,status=400,code='BAD_REQUEST'){super(message);this.status=status;this.code=code;}
}
export async function rpc(name,body){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new ApiError('La base est indisponible.',503,'NOT_CONFIGURED');
  const r=await fetch(`${process.env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{
    method:'POST',headers:{'Content-Type':'application/json',apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
  });
  const data=await r.json();
  if(!r.ok){
    const messages={LOGIN_REQUIRED:'Connectez-vous à Steam pour continuer.',STEAM_LOGIN_REQUIRED:'Cette place est liée à Steam. Connectez-vous pour la retrouver.',ACCESS_DENIED:'Cet accès ne correspond pas à votre compte.',ACCOUNT_ALREADY_LINKED:'Cette place appartient déjà à un autre compte Steam.',ROOM_FULL:'Le salon est complet.',NAME_TAKEN:'Ce pseudo est déjà utilisé. Ajoutez une initiale.',ROOM_NOT_FOUND:'Ce salon est introuvable.',NONCE_REUSED:'Cette connexion Steam a déjà été utilisée. Recommencez.',INVALID_INPUT:'Les données reçues sont invalides.'};
    const code=Object.keys(messages).find(k=>data.message?.includes(k));
    if(code)throw new ApiError(messages[code],['LOGIN_REQUIRED','STEAM_LOGIN_REQUIRED'].includes(code)?401:code==='ACCESS_DENIED'?403:409,code);
    console.error('Account database error',data.code||'unknown');throw new ApiError('La sauvegarde est momentanément indisponible.',502,'DATABASE_ERROR');
  }
  return data;
}
