import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { blank, validState, fromBackup, migrateState } from "../state.mjs";
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
  focus(){}
  remove(){}
  click(){}
}
const response=(state=blank(),n=1)=>new Response(JSON.stringify({etag:etag(n),state,userId:"test-account",schemaVersion:3}));
test("focus quest completion uses normal XP and open focus never completes a task",async()=>{
  const h=await harness();h.app.addQuest("First","build");h.app.addQuest("Second","mind");
  const quests=Object.values(h.app.state.days)[0];
  h.ids.get("focus-quest").value=quests[1].id;await h.ids.get("focus-quest").fire("change");
  await h.ids.get("focus-complete").fire("click");
  assert.equal(quests[0].done,false);assert.equal(quests[1].done,true);
  assert.equal(h.ids.get("total-xp").children[0].textContent,"25 ");
  h.ids.get("focus-quest").value="";await h.ids.get("focus-quest").fire("change");
  assert.equal(h.ids.get("focus-complete").disabled,true);
  await h.ids.get("focus-complete").fire("click");
  assert.equal(quests[0].done,false);assert.equal(h.ids.get("total-xp").children[0].textContent,"25 ");
});
test("milestones follow completed records and reopening a quest removes its earned status",async()=>{
  const h=await harness();
  assert.equal(h.ids.get("milestone-count").textContent,"0 / 4 earned");
  h.app.addQuest("Read a chapter","mind");
  assert.equal(h.ids.get("brief-title").textContent,"Read a chapter");
  let check=h.ids.get("quest-list").children[0].children[0];check.checked=true;await check.fire("change");
  assert.equal(h.ids.get("milestone-count").textContent,"1 / 4 earned");
  assert.equal(h.ids.get("milestones").children[0].dataset.earned,"true");
  assert.equal(h.ids.get("brief-title").textContent,"You've finished what you planned.");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"25 ");
  check=h.ids.get("quest-list").children[0].children[0];check.checked=false;await check.fire("change");
  assert.equal(h.ids.get("milestone-count").textContent,"0 / 4 earned");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"0 ");
});
test("expanded focus view preserves the running timer and saved progress",async()=>{
  const h=await harness(),before=JSON.stringify(h.app.state);
  await h.ids.get("timer-toggle").fire("click");
  await h.ids.get("focus-expand").fire("click");
  assert.equal(h.ids.get("focus-expand")["aria-pressed"],"true");
  assert.equal(h.ids.get("focus-state").textContent,"IN FOCUS");
  await h.ids.get("focus-expand").fire("click");
  assert.equal(h.ids.get("focus-expand")["aria-pressed"],"false");
  assert.equal(h.ids.get("timer-toggle").textContent,"Pause");
  assert.equal(JSON.stringify(h.app.state),before);
});
test("all milestone thresholds derive from existing records without bonus XP",async()=>{
  const fixture=blank();
  for(let i=1;i<=25;i++)fixture.days["2026-09-"+String(i).padStart(2,"0")]=[0,1].map(n=>({id:i+"-"+n,title:"Task",lane:"build",done:true}));
  fixture.bosses["2026-W39"]={title:"Weekly project",done:true};
  const h=await harness(async()=>response(fixture));
  assert.equal(h.ids.get("milestone-count").textContent,"4 / 4 earned");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"1350 ");
  assert.equal(h.ids.get("sleep-summary").textContent,"—");
  assert.equal(h.ids.get("mood-summary").textContent,"—");
});
test("weekly review uses Monday boundaries and ISO goal year without changing records",async()=>{
  const fixture=blank();
  fixture.days["2020-12-28"]=[{id:"a",title:"Done",lane:"build",done:true},{id:"b",title:"Pending",lane:"mind",done:false}];
  fixture.days["2021-01-03"]=[{id:"c",title:"Sunday",lane:"body",done:true}];
  fixture.days["2021-01-04"]=[{id:"d",title:"Next week",lane:"build",done:true}];
  fixture.bosses["2020-W53"]={title:"Ship",done:true};
  const h=await harness(async()=>response(fixture));
  const before=JSON.stringify(h.app.state),summary=h.app.reviewSummary(new Date(2021,0,1));
  assert.equal(summary.days[0].key,"2020-12-28");assert.equal(summary.days[6].key,"2021-01-03");
  assert.equal(summary.done,2);assert.equal(summary.planned,3);assert.equal(summary.active,2);assert.equal(summary.xp,150);
  assert.equal(h.app.reviewSummary(new Date(2021,0,4)).xp,25);
  assert.equal(h.app.reviewSummary(new Date(2020,11,21)).xp,0);
  assert.equal(JSON.stringify(h.app.state),before);
});
test("weekly review navigation and day selection do not edit saved progress",async()=>{
  const h=await harness();const before=JSON.stringify(h.app.state),range=h.ids.get("review-range").textContent;
  assert.equal(h.ids.get("review-days").children.length,7);
  assert.equal(h.ids.get("review-next").disabled,true);
  await h.ids.get("review-prev").fire("click");
  assert.notEqual(h.ids.get("review-range").textContent,range);assert.equal(h.ids.get("review-next").disabled,false);
  await h.ids.get("review-days").children[2].fire("click");
  assert.equal(h.ids.get("review-days").children[2]["aria-pressed"],"true");
  assert.equal(h.ids.get("review-tasks").children[0].textContent,"No quests recorded for this day.");
  await h.ids.get("review-current").fire("click");
  assert.equal(h.ids.get("review-range").textContent,range);
  await h.ids.get("review-next").fire("click");assert.equal(h.ids.get("review-range").textContent,range);
  assert.equal(JSON.stringify(h.app.state),before);
});
async function harness(fetcher=async()=>response(),session=storage(),local=storage(),pages=false){
  const ids=new Map(),cards=Array.from({length:7},()=>new Element());
  const doc={
    hidden:false,activeElement:null,body:new Element(),
    getElementById:id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);},
    createElement:tag=>{
      const n=new Element();
      if(tag==="dialog"){
        n.close=()=>{n.fire("close");};
        n.showModal=()=>queueMicrotask(async()=>{
          const form=n.children[0],editing=form.children[0].textContent==="Edit objective";
          if(editing){
            const answer=prompts.shift();
            if(answer===undefined || answer===null){n.close();return;}
            form.children[3].value=answer;
          }else{
            if(!confirms.shift()){n.close();return;}
            if(form.children[2]?.textContent?.startsWith("TYPE "))form.children[3].value=form.children[2].textContent.slice(5);
          }
          await form.fire("submit");
        });
      }
      return n;
    },createTextNode:text=>({textContent:text}),
    querySelector:selector=>selector.includes("ascend-shared-required")?(pages?null:{}):selector.includes("ascend-storage")?(pages?{}:null):null,
    querySelectorAll:selector=>selector===".card"?cards:[],
    addEventListener(){}
  };
  const prompts=[],confirms=[],context={
    document:doc,window:{addEventListener(){}},location:{protocol:"https:"},localStorage:local,sessionStorage:session,
    fetch:fetcher,AbortController,Date,JSON,Blob,URL,console,
    setTimeout:()=>1,clearTimeout(){},setInterval(){},clearInterval(){},
    confirm:()=>confirms.shift()??false,prompt:()=>prompts.shift()??null,
    blank,validState,fromBackup,migrateState
  };
  vm.createContext(context);
  const exposed=source.replace(/^import .*;\r?\n/,"").replace(/\}\)\(\);\s*$/,
    'globalThis.app={get state(){return state;},sync,addQuest,saveShared,refreshShared,initializeSync,importBackup,render,exportBackup,isoWeek,localDate,tick,reviewSummary};})();');
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
  assert.equal(saved.wellness[day][0].sleep,7.5);assert.deepEqual(saved.vault,["Later idea"]);assert.equal(h.app.sync.dirty,false);
});
test("completion feedback and Undo preserve earned XP without duplicating rewards",async()=>{
  const h=await harness(async()=>{throw new Error("No API");},storage(),storage(),true);
  h.context.window.matchMedia=()=>({matches:true});
  for(const name of ["One","Two","Three"])h.app.addQuest(name,"build");
  for(let i=0;i<3;i++){
    const row=h.ids.get("quest-list").children[i];row.children[0].checked=true;await row.children[0].fire("change");
  }
  assert.equal(h.ids.get("total-xp").children[0].textContent,"75 ");
  assert.equal(h.ids.get("day-status").textContent,"All three complete. Day cleared.");
  assert.equal(h.context.document.body.children.length,0,"reduced motion skips decorative bursts");
  await h.ids.get("quest-list").children[0].children[3].fire("click");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"50 ");
  await h.ids.get("toast").children[1].fire("click");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"75 ");
  const quests=h.app.state.days[h.app.localDate()];
  assert.deepEqual(copy(quests.map(q=>q.title)),["One","Two","Three"]);
  assert.equal(new Set(quests.map(q=>q.id)).size,3);
});

test("dot game moves per catch, stops at the deadline, replays and leaves quest progress unchanged",async()=>{
  const h=await harness(async()=>{throw new Error("No API");},storage(),storage(),true);
  let now=1000;h.context.Date=class extends Date{static now(){return now;}};
  const before=copy(h.app.state),dot=h.ids.get("game-dot"),start=h.ids.get("game-start");
  await start.fire("click");
  const position=[dot.style.left,dot.style.top];
  await dot.fire("click");
  assert.equal(h.ids.get("game-score").textContent,"1");
  assert.notDeepEqual([dot.style.left,dot.style.top],position);
  now=21000;await dot.fire("click");
  assert.equal(h.ids.get("game-score").textContent,"1","expired hits do not score");
  assert.equal(h.ids.get("game-time").textContent,"0");assert.equal(dot.hidden,true);
  assert.equal(start.disabled,false);assert.equal(start.textContent,"Play again");
  await dot.fire("click");assert.equal(h.ids.get("game-score").textContent,"1");
  now++;await start.fire("click");assert.equal(h.ids.get("game-score").textContent,"0");
  assert.equal(dot.hidden,false);assert.equal(h.ids.get("game-time").textContent,"20");
  assert.deepEqual(copy(h.app.state),before);
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
  await assert.rejects(h.app.importBackup({days:{},bosses:{},vault:Array(101).fill("x")}),/Invalid shared state/);
  await h.app.importBackup(blank());assert.equal(Object.keys(h.app.state.days).length,1);
  h.confirms.push(true);await h.app.importBackup(blank());assert.deepEqual(copy(h.app.state),blank());
  h.app.addQuest("Keep until confirmed","body");await h.ids.get("reset-data").fire("click");assert.equal(Object.keys(h.app.state.days).length,1);
  h.confirms.push(true);await h.ids.get("reset-data").fire("click");assert.deepEqual(copy(h.app.state),blank());
});
test("existing browser data is uploaded only after explicit consent",async()=>{
  const local=storage(),data=blank();data.vault=["Local only"];local.setItem("ascend-questboard-v1",JSON.stringify(data));
  const h=await harness(async()=>new Response(JSON.stringify({etag:null,state:blank(),userId:"test-account",schemaVersion:3})),storage(),local);
  assert.deepEqual(copy(h.app.state),blank());assert.equal(h.app.sync.dirty,false);
  h.confirms.push(true);await h.app.initializeSync();assert.deepEqual(copy(h.app.state),data);assert.equal(h.app.sync.dirty,true);
});
test("hosted API failures never silently enter browser-only mode",async()=>{
  for(const status of [401,403,404,503]){
    const h=await harness(async()=>new Response("{}",{status}));assert.equal(h.app.sync.mode,"error");
  }
});

test("Pages saves quests and wellness locally across reload without contacting an API",async()=>{
  const local=storage();let requests=0;
  const fetcher=async()=>{requests++;throw new Error("Pages has no backend");};
  const h=await harness(fetcher,storage(),local,true);
  assert.equal(h.app.sync.mode,"local");
  h.app.addQuest("Pages persistence check","build");
  h.ids.get("wellness-note").value="Local check-in";
  await h.ids.get("wellness-form").fire("submit");
  const reloaded=await harness(fetcher,storage(),local,true);
  assert.deepEqual(copy(reloaded.app.state),copy(h.app.state));
  assert.equal(reloaded.app.state.days[reloaded.app.localDate()][0].title,"Pages persistence check");
  assert.equal(reloaded.app.state.wellness[reloaded.app.localDate()][0].note,"Local check-in");
  assert.equal(requests,0);
});

test("ISO week boundaries and local calendar dates stay consistent",async()=>{
  const h=await harness();
  assert.equal(h.app.isoWeek(new Date(2021,0,1)),"2020-W53");
  assert.equal(h.app.isoWeek(new Date(2021,0,4)),"2021-W01");
  assert.equal(h.app.isoWeek(new Date(2025,11,29)),"2026-W01");
  assert.equal(h.app.localDate(new Date(2026,9,29,23,59)),"2026-10-29");
});
test("focus timer uses elapsed wall time after a background pause and never awards XP",async()=>{
  const h=await harness();let now=100000;
  h.context.Date=class extends Date{static now(){return now;}};
  await h.ids.get("timer-toggle").fire("click");now+=95000;h.app.tick();
  assert.equal(h.ids.get("timer").textContent,"13:25");
  await h.ids.get("timer-toggle").fire("click");now+=50000;h.app.tick();
  assert.equal(h.ids.get("timer").textContent,"13:25");
  await h.ids.get("timer-toggle").fire("click");now+=805000;h.app.tick();
  assert.equal(h.ids.get("timer").textContent,"00:00");
  assert.equal(h.ids.get("total-xp").children[0].textContent,"0 ");
  await h.ids.get("timer-reset").fire("click");assert.equal(h.ids.get("timer").textContent,"15:00");
});
test("old backups retain unknown ownership and full v3 backups round-trip unchanged",()=>{
  const old={version:2,days:{},bosses:{},vault:[],wellness:{"2026-10-29":{mood:"okay",sleep:8,energy:"low",note:"Legacy"}}};
  const migrated=fromBackup(old);
  assert.equal(migrated.wellness["2026-10-29"][0].authorId,null);
  assert.deepEqual(fromBackup({version:3,...migrated}),migrated);
});
