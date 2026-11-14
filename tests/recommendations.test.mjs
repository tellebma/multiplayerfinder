import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/recommendations.js';
const R=globalThis.JVRecommendations;
const game=(id,genre,kind='Compétitif')=>({id,name:id,genre,kind,modes:['online'],minutes:[25,45],price:0});
const catalog=[game('cs','FPS'),game('lol','MOBA'),game('valorant','FPS'),game('dota','MOBA'),game('forest','Survie','Coopération')];
test('cold start preserves editorial order and does not invent a preference',()=>{
  assert.deepEqual(R.rank(catalog,catalog,{},catalog.map(g=>g.id)).map(g=>g.id),catalog.map(g=>g.id));
});
test('a super-like outweighs a regular like for another genre',()=>{
  const candidates=catalog.slice(2),order=catalog.map(g=>g.id);
  assert.equal(R.rank(candidates,catalog,{cs:'super',lol:'yes'},order)[0].id,'valorant');
  assert.equal(R.rank(candidates,catalog,{cs:'yes',lol:'super'},order)[0].id,'dota');
});
test('a refusal reduces similar games without excluding other genres',()=>{
  const ranked=R.rank(catalog.slice(2),catalog,{cs:'no'},catalog.map(g=>g.id));
  assert.equal(ranked.at(-1).id,'valorant');assert.equal(ranked.length,3);
});
test('super-likes remain positive votes, with an explanation based on real feedback',()=>{
  assert.equal(R.positive('super'),true);assert.equal(R.positive('no'),false);
  assert.match(R.explain(catalog[2],catalog,{cs:'super'}),/super-like sur cs/);
});
