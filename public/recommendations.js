/* Explainable, local preference ranking. No votes from other members are used. */
globalThis.JVRecommendations=(()=>{
  const positive=vote=>vote==='yes'||vote==='super';
  const weight=vote=>vote==='super'?4:vote==='yes'?1:vote==='no'?-1:0;
  const duration=g=>!g.minutes?'unknown':g.minutes[0]<=20?'short':g.minutes[0]<=45?'medium':'long';
  const budget=g=>g.price==null?'unknown':g.price===0?'free':g.price<=10?'small':'paid';
  function similarity(a,b){
    let score=a.genre===b.genre?.62:0;
    if(a.kind===b.kind)score+=.17;
    if(duration(a)!=='unknown'&&duration(a)===duration(b))score+=.11;
    if(budget(a)!=='unknown'&&budget(a)===budget(b))score+=.05;
    if(a.modes.some(m=>b.modes.includes(m)))score+=.05;
    return score;
  }
  function signals(catalog,decisions){return catalog.filter(g=>weight(decisions[g.id])).map(g=>({game:g,weight:weight(decisions[g.id])}));}
  function score(game,preferences){const total=preferences.reduce((sum,p)=>sum+Math.abs(p.weight),0);return total?preferences.reduce((sum,p)=>sum+p.weight*similarity(game,p.game),0)/total:0;}
  function rank(candidates,catalog,decisions,order){
    const preferences=signals(catalog,decisions);
    if(!preferences.length)return [...candidates].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    const queue=candidates.map(g=>({game:g,score:score(g,preferences)})).sort((a,b)=>b.score-a.score||order.indexOf(a.game.id)-order.indexOf(b.game.id));
    const ranked=[];
    // Avoid a whole deck of the same genre; keep occasional close alternatives.
    while(queue.length){let index=0;if(ranked.length>=2&&ranked.at(-1).genre===ranked.at(-2).genre){const other=queue.slice(0,6).findIndex(p=>p.game.genre!==ranked.at(-1).genre);if(other>=0)index=other;}ranked.push(queue.splice(index,1)[0].game);}
    return ranked;
  }
  function explain(game,catalog,decisions){
    const liked=catalog.filter(g=>positive(decisions[g.id])).map(g=>({game:g,strength:similarity(game,g)*(decisions[g.id]==='super'?1.35:1)})).sort((a,b)=>b.strength-a.strength);
    const best=liked[0];if(!best||best.strength<.5)return 'Une autre ambiance à explorer pour affiner vos goûts.';
    return `${decisions[best.game.id]==='super'?'Votre super-like':'Votre like'} sur ${best.game.name} oriente cette suggestion.`;
  }
  return {positive,weight,similarity,score,signals,rank,explain};
})();
