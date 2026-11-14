import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/room.js',import.meta.url),'utf8');
const functions=['updateSnapshot','poll'].map(name=>{
  const start=source.indexOf(`${name==='poll'?'async ':''}function ${name}(`);
  const end=source.indexOf('\n',start);
  return source.slice(start,end);
}).join('\n');

function setup({view='discover',video=false,dialog=false}={}){
  const counts={renders:0,sidebars:0,group:0};
  let data={members:[{id:'friend',votes:1}],votes:{},matches:[]};
  const context=vm.createContext({
    session:{},snapshot:{members:[{id:'friend',votes:0}],votes:{},matches:[]},
    pollRunning:false,busy:false,document:{hidden:false},view,
    state:{decisions:{}},groupMatchIds:[],games:[],
    requestRoom:async()=>data,save(){},toast(){},
    renderGroup(){counts.group++;},render(){counts.renders++;},renderSidebar(){counts.sidebars++;},
    $(selector){if(selector==='#results video')return video?{}:null;if(selector==='#details-dialog')return {open:dialog};return {classList:{remove(){},add(){}},textContent:''};},
  });
  vm.runInContext(`function filtered(){return (view==='matches'?groupMatchIds:['game']).map(id=>({id}));}\n${functions}`,context);
  return {counts,context,setData(next){data=next;},poll:()=>vm.runInContext('poll()',context)};
}
test('another member voting updates the sidebar without rebuilding a playing trailer',async()=>{
  const app=setup({video:true});await app.poll();
  assert.equal(app.counts.renders,0);assert.equal(app.counts.sidebars,1);assert.equal(app.counts.group,1);
});
test('unchanged match list preserves the video in an open detail dialog',async()=>{
  const app=setup({view:'matches',dialog:true});await app.poll();assert.equal(app.counts.renders,0);
});
test('new matches refresh the list, with modal videos scoped outside that render',async()=>{
  const app=setup({view:'matches',dialog:true});app.setData({members:[],votes:{},matches:['game']});await app.poll();assert.equal(app.counts.renders,1);
});
test('a late polling response does not overwrite an in-flight user vote',async()=>{
  const app=setup();app.context.requestRoom=async()=>{app.context.busy=true;return {members:[],votes:{},matches:[]};};await app.poll();assert.equal(app.counts.group,0);assert.equal(app.context.pollRunning,false);
});
