import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { blank, validState, fromBackup } from "../state.mjs";
const source=await readFile(new URL("../app.js",import.meta.url),"utf8");
const copy=v=>JSON.parse(JSON.stringify(v));
const etag=n=>String(n).padStart(32,"0");
const storage=()=>{
  const items=new Map();
  return {getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
};
class Element {
  constructor(){this.children=[];this.events={};this.dataset={};this.value="";this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this[k]=v;}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  async fire(name,e={}){for(const fn of this.events[name]??[])await fn({preventDefault(){},target:this,...e});}
  remove(){}
  click(){}
}
const response=(state=blank(),n=1)=>new Response(JSON.stringify({etag:etag(n),state}));
async function harness(fetcher=async()=>response(),session=storage(),local=storage()){
  const ids=new Map(),cards=Array.from({length:7},()=>new Element());
  const doc={
    hidden:false,activeElement:null,body:new Element(),
    getElementById:id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);},
    createElement:()=>new Element(),createTextNode:text=>({textContent:text}),
    querySelector:selector=>selector.includes("ascend-shared-required")?{}:null,
    querySelectorAll:selector=>selector===".card"?cards:[],
    addEventListener(){}
  };
  const prompts=[],confirms=[],context={
    document:doc,window:{addEventListener(){}},location:{protocol:"https:"},localStorage:local,sessionStorage:session,
    fetch:fetcher,AbortController,Date,JSON,Blob,URL,console,
    setTimeout:()=>1,clearTimeout(){},setInterval(){},
    confirm:()=>confirms.shift()??false,prompt:()=>prompts.shift()??null,
    blank,validState,fromBackup
  };
  vm.createContext(context);
  const exposed=source.replace(/^import .*;\n/,"").replace(/\}\)\(\);\s*$/,
    'globalThis.app={get state(){return state;},sync,addQuest,saveShared,refreshShared,initializeSync,importBackup,render,exportBackup};})();');
  vm.runInContext(exposed,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {app:context.app,ids,context,prompts,confirms,session,local,cards};
}
test("quest add/edit/complete, XP, weekly boss, vault and wellness use real UI handlers",async()=>{
  let saved;
  const h=await harness(async(_u,o={})=>{
    if(o.method==="PUT"){saved=JSON.parse(o.body).state;return new Response(JSON.stringify({etag:etag(2)}));}
    return response();
  });
  h.app.addQuest("First","build");h.app.addQuest("Second","mind");h.app.addQuest("Third","body");h.app.addQuest("Fourth","build");
  const day=Object.keys(h.app.state.days)[0];assert.equal(h.app.state.days[day].length,3);
  let row=h.ids.get("quest-list").children[0];
  h.prompts.push("Edited first");await row.children[2].fire("click");
  assert.equal(h.app.state.days[day][0].title,"Edited first");
  row=h.ids.get("quest-list").children[0];row.children[0].checked=true;await row.children[0].fire("change");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"25 ");
  const bossForm=h.ids.get("boss-box").children[0],bossInput=bossForm.children[1].children[0];
  bossInput.value="Finish chapter";await bossForm.fire("submit");
  await h.ids.get("boss-box").children[0].children[1].fire("click");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"125 ");
  h.context.document.getElementById("vault-input").value="Later idea";await h.ids.get("vault-form").fire("submit");
  h.ids.get("wellness-sleep").value="7.5";h.ids.get("wellness-energy").value="okay";h.ids.get("wellness-note").value="Take a walk";
  await h.ids.get("wellness-form").fire("submit");await h.app.saveShared();
  assert.equal(saved.wellness[day].sleep,7.5);assert.deepEqual(saved.vault,["Later idea"]);assert.equal(h.app.sync.dirty,false);
});
test("a second edit during PUT remains dirty and is saved with the returned ETag",async()=>{
  let release,write=0,bodies=[];
  const h=await harness(async(_u,o={})=>{
    if(!o.method)return response();
    bodies.push(JSON.parse(o.body));write++;
    if(write===1)return new Promise(r=>{release=r;});
    return new Response(JSON.stringify({etag:etag(3)}));
  });
  h.app.addQuest("One","build");const saving=h.app.saveShared();
  h.app.addQuest("Two","mind");release(new Response(JSON.stringify({etag:etag(2)})));await saving;
  assert.equal(h.app.sync.dirty,true);await h.app.saveShared();
  assert.equal(bodies[1].etag,etag(2));assert.equal(Object.values(bodies[1].state.days)[0].length,2);assert.equal(h.app.sync.dirty,false);
});
test("a stale background GET cannot overwrite an edit completed while GET was in flight",async()=>{
  let release,reads=0;
  const h=await harness(async(_u,o={})=>{
    if(o.method)return new Response(JSON.stringify({etag:etag(3)}));
    if(++reads===1)return response();
    return new Promise(r=>{release=r;});
  });
  const refreshing=h.app.refreshShared();h.app.addQuest("Do not lose this","mind");
  await h.app.saveShared();release(response(blank(),2));await refreshing;
  assert.equal(Object.values(h.app.state.days)[0][0].title,"Do not lose this");assert.equal(h.app.sync.etag,etag(3));
});
test("failed saves survive a refresh in session storage and recover against the same version",async()=>{
  const session=storage();
  const h=await harness(async(_u,o={})=>{if(o.method)throw new Error("offline");return response();},session);
  h.app.addQuest("Keep draft","body");await h.app.saveShared();assert.equal(h.app.sync.mode,"error");
  const reopened=await harness(async()=>response(),session);
  assert.equal(Object.values(reopened.app.state.days)[0][0].title,"Keep draft");assert.equal(reopened.app.sync.dirty,true);
  assert.equal(reopened.app.sync.mode,"online");
});
test("conflicts freeze edits, retain the local draft, and require confirmed recovery",async()=>{
  const remote=blank();remote.vault=["Other browser's idea"];
  const h=await harness(async(_u,o={})=>o.method?new Response("{}",{status:409}):response(remote));
  h.app.addQuest("Local change","mind");await h.app.saveShared();
  assert.equal(h.app.sync.mode,"conflict");assert.equal(h.app.sync.dirty,true);assert.equal(h.cards.every(c=>c.inert),true);
  const button=h.ids.get("sync-banner").children.at(-1);await button.fire("click");assert.equal(h.app.sync.mode,"conflict");
  h.confirms.push(true);await button.fire("click");await new Promise(r=>setImmediate(r));
  assert.equal(h.app.sync.mode,"online");assert.deepEqual(copy(h.app.state),remote);
});
test("a lost PUT acknowledgement is recognized without duplicate updates",async()=>{
  let remote=blank(),reads=0;
  const h=await harness(async(_u,o={})=>{
    if(o.method){remote=JSON.parse(o.body).state;return new Response("{}",{status:409});}
    return response(remote,++reads);
  });
  h.app.addQuest("Accepted remotely","build");await h.app.saveShared();
  assert.equal(h.app.sync.mode,"online");assert.equal(h.app.sync.dirty,false);
});
test("unsaved wellness fields survive unrelated rendering",async()=>{
  const h=await harness();h.ids.get("wellness-note").value="Unsubmitted note";await h.ids.get("wellness-form").fire("input");
  h.app.addQuest("Other edit","mind");assert.equal(h.ids.get("wellness-note").value,"Unsubmitted note");
});
test("imports and resets require confirmation and reject malformed backups without truncation",async()=>{
  const h=await harness();h.app.addQuest("Keep me","mind");
  assert.throws(()=>h.app.importBackup({days:{},bosses:{},vault:Array(101).fill("x")}),/Invalid backup/);
  h.app.importBackup(blank());assert.equal(Object.keys(h.app.state.days).length,1);
  h.confirms.push(true);h.app.importBackup(blank());assert.deepEqual(copy(h.app.state),blank());
  h.app.addQuest("Keep until confirmed","body");await h.ids.get("reset-data").fire("click");assert.equal(Object.keys(h.app.state.days).length,1);
  h.confirms.push(true);await h.ids.get("reset-data").fire("click");assert.deepEqual(copy(h.app.state),blank());
});
test("existing browser data is uploaded only after explicit consent",async()=>{
  const local=storage(),data=blank();data.vault=["Local only"];local.setItem("ascend-questboard-v1",JSON.stringify(data));
  const h=await harness(async()=>new Response(JSON.stringify({etag:null,state:blank()})),storage(),local);
  assert.deepEqual(copy(h.app.state),blank());assert.equal(h.app.sync.dirty,false);
  h.confirms.push(true);await h.app.initializeSync();assert.deepEqual(copy(h.app.state),data);assert.equal(h.app.sync.dirty,true);
});
test("hosted API failures never silently enter browser-only mode",async()=>{
  for(const status of [401,403,404,503]){
    const h=await harness(async()=>new Response("{}",{status}));assert.equal(h.app.sync.mode,"error");
  }
});
