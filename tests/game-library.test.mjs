import test from 'node:test';
import assert from 'node:assert/strict';
import { steamGame,searchSteam,importSteam } from '../lib/game-library.js';
const source={type:'game',name:'Example &amp; Friends',platforms:{windows:true},categories:[{id:1},{id:9},{id:36}],genres:[{description:'Simulation'}],short_description:'<b>Build</b> &amp; survive.',header_image:'https://shared.akamai.steamstatic.com/a.jpg',price_overview:{currency:'EUR',final:1999},movies:[]};
test('Steam multiplayer tags never invent a five-person capacity or session duration',()=>{
  const g=steamGame(source,'123');assert.equal(g.name,'Example & Friends');assert.equal(g.description,'Build & survive.');assert.equal(g.price,19.99);assert.equal(g.uncertain,true);assert.equal(g.minPlayers,null);assert.equal(g.maxPlayers,null);assert.equal(g.minutes,null);assert.deepEqual(g.modes,['online']);assert.equal(g.external,true);
  assert.throws(()=>steamGame({...source,type:'dlc'},'123'),/jeu PC/);
  assert.throws(()=>steamGame({...source,categories:[{id:2}]},'123'),/multijoueur/);
  assert.throws(()=>steamGame({...source,platforms:{linux:true}},'123'),/jeu PC/);
  assert.equal(steamGame({...source,is_free:true},'123').price,0);
  const crossplay=steamGame({...source,categories:[{id:1},{id:27},{id:38}]},'123');
  assert.deepEqual(crossplay.modes,['online']);assert.equal(crossplay.kind,'Coopération');
  assert.deepEqual(steamGame({...source,categories:[{id:1},{id:27}]},'123').modes,[]);
});
test('remote search and imports reject invalid input without contacting Steam or the database',async()=>{
  await assert.rejects(searchSteam('a'),/2 et 80/);
  await assert.rejects(searchSteam('x'.repeat(81)),/2 et 80/);
  for(const id of ['0','../123','123?url=x','https://evil.example','12345678901'])await assert.rejects(importSteam(id),/Identifiant/);
});
