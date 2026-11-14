/* Search the wider Steam catalogue; only the server imports official metadata. */
const libraryButton=document.createElement('button');
libraryButton.id='open-library';libraryButton.className='library-entry';
libraryButton.innerHTML='<span><strong>Un jeu vous manque ?</strong> Cherchez dans le catalogue Steam et proposez-le à la bande.</span><span>+ Trouver un jeu ↗</span>';
$('.content-top').after(libraryButton);
const libraryDialog=document.createElement('dialog');libraryDialog.id='library-dialog';
libraryDialog.innerHTML='<button class="close-dialog" aria-label="Fermer">×</button><div class="about-content"><div class="eyebrow">PLUS DE JEUX POUR LA BANDE</div><h2>Explorez Steam.</h2><p>Recherchez un titre puis ajoutez sa fiche au catalogue partagé. Les jeux PC signalés comme multijoueurs peuvent être importés.</p><form id="library-search-form"><label class="sr-only" for="library-term">Nom du jeu sur Steam</label><input id="library-term" type="search" minlength="2" maxlength="80" required placeholder="Ex. : Project Zomboid, Factorio…"><button class="primary-button" type="submit">Chercher</button></form><p class="library-warning">Le nombre de joueurs reste à confirmer pour les imports. Ils sont exclus du filtre « compatibles uniquement », mais vous pouvez ouvrir leur fiche, les aimer et obtenir un match.</p><p id="library-status" role="status" aria-live="polite"></p><div id="library-results"></div><p class="tiny muted">Source : Steam · Les jeux absents de Steam, comme Minecraft, sont ajoutés séparément à notre sélection.</p></div>';
document.body.append(libraryDialog);
libraryDialog.querySelector('.close-dialog').onclick=()=>libraryDialog.close();
let libraryController,libraryFetching=false;
libraryDialog.addEventListener('close',()=>libraryController?.abort());
libraryButton.onclick=()=>{libraryDialog.showModal();$('#library-term').value=$('#search').value;$('#library-term').focus();if($('#library-term').value.trim().length>=2)$('#library-search-form').requestSubmit();};
$('#library-search-form').onsubmit=async e=>{
  e.preventDefault();libraryController?.abort();const controller=libraryController=new AbortController();
  const term=$('#library-term').value.trim();if(term.length<2)return;
  $('#library-status').textContent='Recherche dans Steam…';$('#library-results').replaceChildren();
  try{
    const r=await fetch(`/api/games/search?q=${encodeURIComponent(term)}`,{signal:controller.signal});const data=await r.json();if(!r.ok)throw Error(data.error);
    if(controller!==libraryController)return;
    $('#library-status').textContent=data.items.length?`${data.items.length} résultat(s). Le mode multijoueur sera vérifié à l’ajout.`:'Aucun résultat Steam. Essayez le titre original du jeu.';
    $('#library-results').innerHTML=data.items.map(g=>`<article class="library-result">${g.image?`<img src="${esc(g.image)}" alt="" loading="lazy">`:''}<div><h3>${esc(g.name)}</h3><p>${money(g.price)} · PC</p><a href="${esc(g.source)}" target="_blank" rel="noopener noreferrer">Voir sur Steam ↗</a></div><button class="outline-button" data-library-id="${g.id}">${games.some(x=>x.id===g.id)?'Voir la fiche':'Ajouter et voir'}</button></article>`).join('');
    $$('[data-library-id]',libraryDialog).forEach(b=>b.onclick=()=>addLibraryGame(b));
  }catch(e){if(e.name!=='AbortError')$('#library-status').textContent=e.message||'Recherche indisponible. Réessayez.';}
};
async function addLibraryGame(button){
  if(libraryFetching)return;libraryFetching=true;button.disabled=true;
  const id=button.dataset.libraryId;
  try{
    if(!games.some(g=>g.id===id)){
      button.textContent='Ajout…';
      const r=await fetch('/api/games/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});const d=await r.json();if(!r.ok)throw Error(d.error);
      if(!games.some(g=>g.id===id)){games.push(d.game);order.push(id);}
    }
    libraryDialog.close();openDetails(id);
  }catch(e){$('#library-status').textContent=e.message||'Impossible d’ajouter ce jeu.';}
  finally{libraryFetching=false;button.disabled=false;button.textContent=games.some(g=>g.id===id)?'Voir la fiche':'Ajouter et voir';}
}
let libraryRefresh;
window.refreshGameLibrary=()=>libraryRefresh??=(async()=>{
  try{const r=await fetch('/api/games');if(!r.ok)return;const d=await r.json();const known=new Set(games.map(g=>g.id));const added=d.games.filter(g=>!known.has(g.id));if(!added.length)return;games.push(...added);order.push(...added.map(g=>g.id));if(!$('#results .media.playing')&&!$('dialog[open]'))render();}
  catch{}finally{libraryRefresh=null;}
})();
setInterval(()=>{if(!document.hidden)window.refreshGameLibrary();},30000);
