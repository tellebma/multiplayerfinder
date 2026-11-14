import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive:true });
await cp('public','dist',{recursive:true});
const catalog=JSON.parse(await readFile('catalog.json','utf8'));
await writeFile('dist/catalog.json',JSON.stringify(catalog));
console.log(`JVFinder: ${catalog.games.length} games, static assets ready in dist/`);
