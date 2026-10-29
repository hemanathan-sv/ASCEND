import { validState, blank, fromBackup, migrateState } from "./state.mjs";
(() => {
  "use strict";
  const KEY = "ascend-questboard-v1";
  const SHARED_API = "/api/shared";
  const XP_QUEST = 25;
  const XP_BOSS = 100;
  const XP_LEVEL = 150;
  const LANES = {
    mind: { label: "Learn" },
    build: { label: "Build" },
    body: { label: "Body" }
  };
  const $ = id => document.getElementById(id);
  function localDate(d = new Date()) {
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
  }
  function isoWeek(d = new Date()) {
    const utc = new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    utc.setUTCDate(utc.getUTCDate()+4-(utc.getUTCDay() || 7));
    const year=utc.getUTCFullYear();
    const start=new Date(Date.UTC(year,0,1));
    const week=Math.ceil((((utc-start)/86400000)+1)/7);
    return String(year)+"-W"+String(week).padStart(2,"0");
  }
  function read() {
    try { return fromBackup(JSON.parse(localStorage.getItem(KEY) || "null")); }
    catch { return blank(); }
  }
  const DRAFT_KEY = KEY + "-pending-shared";
  let state=blank(), today=localDate(), week=isoWeek(), wellnessDraft=false, userId="local-browser";
  const sync={mode:"checking",etag:null,saving:false,dirty:false,timer:null,revision:0,refreshing:false,operation:"update",confirmation:null};
  function readDraft() {
    try {
      const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && validState(migrateState(draft.state)) && (draft.etag===null || /^[a-f0-9]{32}$/.test(draft.etag)) ? {...draft,state:migrateState(draft.state)} : null;
    } catch { return null; }
  }
  function retainDraft() {
    try { sessionStorage.setItem(DRAFT_KEY,JSON.stringify({etag:sync.etag,state,operation:sync.operation,confirmation:sync.confirmation})); }
    catch { toast("This browser cannot keep an unsaved draft. Keep this tab open or export a backup."); }
  }
  function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch {} }
  function editable(value) {
    document.querySelectorAll(".card").forEach(card=>{if(card.id!=="focus")card.inert=!value;});
  }
  function validPayload(p) {
    return p && Object.hasOwn(p,"etag") && (p.etag===null || (typeof p.etag==="string" && /^[a-f0-9]{32}$/.test(p.etag))) && validState(p.state) && p.schemaVersion===3 && typeof p.userId==="string";
  }
  async function requestShared(options={}) {
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
    try { return await fetch(SHARED_API,{credentials:"same-origin",cache:"no-store",...options,signal:controller.signal}); }
    finally { clearTimeout(timeout); }
  }
  let timerMinutes=15,timerRemaining=15*60,timerEnd=null,timerRunning=false;
  let toastHandle,storageWarned=false;
  const element=(tag,cls,text)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=text;
    return n;
  };
  function toast(text,action=null) {
    const n=$("toast");n.replaceChildren(document.createTextNode(text));n.classList.add("show");
    if(action){
      const button=element("button","toast-action",action.label);button.type="button";
      button.addEventListener("click",()=>{clearTimeout(toastHandle);n.classList.remove("show");action.run();});n.append(button);
    }
    clearTimeout(toastHandle);toastHandle=setTimeout(()=>n.classList.remove("show"),action?6500:3200);
  }
  function reward(xp,previousXP) {
    const levelUp=Math.floor(totalStats().xp/XP_LEVEL)>Math.floor(previousXP/XP_LEVEL);
    const cleared=currentQuests().filter(q=>q.done).length===3;
    toast(levelUp?"Level "+(Math.floor(totalStats().xp/XP_LEVEL)+1)+" reached · +"+xp+" XP":xp===XP_BOSS?"Weekly goal complete · +100 XP":cleared?"All three complete · +"+xp+" XP":"Quest complete · +"+xp+" XP");
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return;
    document.querySelector(".reward-burst")?.remove();
    const burst=element("div","reward-burst");burst.setAttribute("aria-hidden","true");
    burst.append(element("strong","reward-label",levelUp?"Level up!":"+"+xp+" XP"));
    if(levelUp || cleared || xp===XP_BOSS){
      for(let i=0;i<12;i++){
        const piece=element("i","reward-piece");
        const angle=i*Math.PI/6;
        piece.style.setProperty("--x",Math.cos(angle)*100+"px");piece.style.setProperty("--y",Math.sin(angle)*70-24+"px");
        piece.style.setProperty("--turn",i*47+"deg");burst.append(piece);
      }
    }
    document.body.append(burst);setTimeout(()=>burst.remove(),1300);
  }
  function ask(message,{value=null,phrase=null,maxLength=160}={}) {
    return new Promise(resolve=>{
      const dialog=element("dialog","action-dialog"),form=element("form");
      const heading=element("h2","",value!==null?"Edit objective":sync.mode==="local"?"Confirm action":"Confirm shared action");
      heading.id="action-dialog-title";dialog.setAttribute("aria-labelledby",heading.id);
      const description=element("p","",message),row=element("div","dialog-actions");
      let input;
      if(value!==null || phrase){
        const label=element("label","field-label",phrase?"TYPE "+phrase:"OBJECTIVE");
        input=element("input");input.value=value || "";input.maxLength=phrase?80:maxLength;input.required=true;
        input.id="action-dialog-input";label.htmlFor=input.id;form.append(heading,description,label,input);
      }else form.append(heading,description);
      const cancel=element("button","text-button","Cancel");cancel.type="button";
      const accept=element("button","action-button",value!==null?"Save changes":"Confirm");accept.type="submit";
      const error=element("p","dialog-error","");error.setAttribute("role","alert");
      row.append(cancel,accept);form.append(error,row);dialog.append(form);document.body.append(dialog);
      let result=null;
      cancel.addEventListener("click",()=>dialog.close());
      form.addEventListener("submit",e=>{
        e.preventDefault();
        if(phrase && input.value!==phrase){error.textContent="Type the exact confirmation phrase.";return;}
        if(value!==null && !input.value.trim())return;
        result=value!==null?input.value.trim():true;dialog.close();
      });
      dialog.addEventListener("close",()=>{dialog.remove();resolve(result);},{once:true});
      dialog.showModal();input?.focus();
    });
  }
  function persist() {
    sync.revision++;
    if(sync.mode==="online") {
      sync.dirty=true;retainDraft();scheduleSave();
      syncBanner("Changes pending secure sync…");
      return;
    }
    if(sync.mode!=="local")return;
    try { localStorage.setItem(KEY,JSON.stringify(state)); }
    catch { if(!storageWarned){toast("Storage is disabled. Export your progress.");storageWarned=true;} }
  }
  function hasProgress(s) {
    return !!(Object.keys(s.days).length || Object.keys(s.bosses).length || Object.keys(s.wellness).length || s.vault.length);
  }
  function syncBanner(message,mode=sync.mode,retry=false) {
    const banner=$("sync-banner");banner.dataset.mode=mode;
    banner.replaceChildren(document.createTextNode(message));
    $("privacy-label").textContent=mode==="online"?"Shared profile":mode==="local"?"This browser only":"Not connected";
    if(sync.dirty || mode==="conflict"){
      const backup=element("button","","Export unsaved backup");backup.type="button";
      backup.addEventListener("click",exportBackup);banner.append(backup);
    }
    if(mode==="conflict"){
      const latest=element("button","","Load latest shared profile");latest.type="button";
      latest.addEventListener("click",async()=>{
        if(!await ask("Discard this tab's unsaved changes and load the latest shared profile? Export your unsaved backup first.",{phrase:"DISCARD DRAFT"}))return;
        sync.dirty=false;clearDraft();wellnessDraft=false;initializeSync();
      });banner.append(latest);
    } else if(retry) {
      const button=element("button","","Try again");button.type="button";
      button.addEventListener("click",()=>{
        if(sync.saving)return;
        if(sync.dirty){sync.mode="online";editable(true);scheduleSave();}
        else initializeSync();
      });banner.append(button);
    }
  }
  function scheduleSave() {
    if(sync.timer)clearTimeout(sync.timer);
    sync.timer=setTimeout(saveShared,350);
  }
  async function saveShared() {
    if(sync.mode!=="online" || sync.saving || !sync.dirty)return;
    if(!validState(state)){sync.mode="error";editable(false);syncBanner("Data exceeds the supported backup limits. Export a backup for recovery.",sync.mode);return;}
    sync.saving=true;
    const revision=sync.revision,snapshot=JSON.stringify(state),operation=sync.operation,confirmation=sync.confirmation;
    syncBanner("Saving shared progress…");
    try {
      const response=await requestShared({
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({etag:sync.etag,state:JSON.parse(snapshot),...(operation!=="update"?{operation,confirmation}:{})})
      });
      if(response.status===409) {
        // A timed-out request may already have committed. Recognize that safely.
        const latest=await requestShared(), payload=latest.ok?await latest.json():null;
        if(!validPayload(payload) || JSON.stringify(payload.state)!==snapshot) {
          sync.mode="conflict";editable(false);
          syncBanner("Both browsers changed progress. Your unsaved version is kept in this tab. Export it, then load the latest profile.",sync.mode);return;
        }
        sync.etag=payload.etag;
      } else {
        if(!response.ok)throw new Error("Save failed");
        const result=await response.json();
        if(typeof result.etag!=="string" || !/^[a-f0-9]{32}$/.test(result.etag))throw new Error("Invalid response");
        sync.etag=result.etag;
      }
      if(sync.operation===operation){sync.operation="update";sync.confirmation=null;}
      sync.dirty=sync.revision!==revision;
      if(sync.dirty)retainDraft();else clearDraft();
      syncBanner(sync.dirty?"Saving remaining changes…":"All changes saved");
    } catch {
      sync.mode="error";sync.dirty=true;retainDraft();editable(false);
      syncBanner("Couldn't confirm the save. Your draft is kept in this tab, including after refresh. Retry or export it.",sync.mode,true);
    } finally {
      sync.saving=false;
      if(sync.mode==="online" && sync.dirty)scheduleSave();
    }
  }
  async function initializeSync() {
    if(sync.saving)return;
    if(document.querySelector('meta[name="ascend-storage"][content="local"]') &&
        !document.querySelector('meta[name="ascend-shared-required"]')){
      state=read();sync.mode="local";render();
      syncBanner("Saved in this browser. Export a backup to keep a copy. This version does not sync across devices.");
      editable(true);return;
    }
    if(location.protocol==="file:"){
      state=read();sync.mode="local";render();syncBanner("Browser-only mode · Open the private hosted app to sync across devices.");editable(true);return;
    }
    sync.mode="checking";syncBanner("Connecting to private shared progress…");editable(false);
    try {
      const response=await requestShared();
      if(response.status===404 && !document.querySelector('meta[name="ascend-shared-required"]')) {
        state=read();sync.mode="local";render();syncBanner("Browser-only preview · Not connected to shared storage.");editable(true);return;
      }
      if(!response.ok)throw new Error("Shared profile unavailable");
      const payload=await response.json();
      if(!validPayload(payload))throw new Error("Invalid shared profile");
      const draft=readDraft(), localState=read();
      userId=payload.userId;
      sync.etag=payload.etag;sync.mode="online";
      if(draft && JSON.stringify(draft.state)!==JSON.stringify(payload.state)) {
        state=draft.state;sync.operation=draft.operation || "update";sync.confirmation=draft.confirmation;sync.dirty=true;render();
        if(draft.etag!==payload.etag){
          sync.etag=draft.etag;sync.mode="conflict";editable(false);
          syncBanner("A draft from this tab conflicts with newer shared progress. Export it, then load the latest profile.",sync.mode);return;
        }
        editable(true);scheduleSave();syncBanner("Recovered this tab's unsaved changes. Retrying secure sync…");return;
      }
      clearDraft();sync.dirty=false;sync.operation="update";sync.confirmation=null;state=payload.state;render();editable(true);
      syncBanner("Shared profile loaded");
      if(payload.etag===null && hasProgress(localState) &&
          await ask("Upload this browser's existing ASCEND progress, including wellness, to the shared profile for both authorized people? Older entries remain unattributed.")) {
        state=localState;sync.operation="restore";sync.confirmation="REPLACE SHARED PROFILE";render();persist();
      }
    } catch {
      const draft=readDraft();if(draft){state=draft.state;sync.etag=draft.etag;sync.dirty=true;render();}
      sync.mode="error";editable(false);
      syncBanner("Private sync is unavailable. Reconnect before editing. Unsaved changes can be exported.",sync.mode,true);
    }
  }
  async function refreshShared() {
    if(sync.mode!=="online" || sync.saving || sync.dirty || sync.refreshing || document.hidden || wellnessDraft ||
        document.querySelector("dialog[open]") || document.activeElement?.matches("input, textarea, select"))return;
    const revision=sync.revision;sync.refreshing=true;
    try {
      const response=await requestShared();
      if(!response.ok)throw new Error("Refresh failed");
      const payload=await response.json();
      if(!validPayload(payload))throw new Error("Invalid shared profile");
      // Edits or a save made while GET was in flight always win locally.
      if(payload.userId!==userId){sync.mode="error";editable(false);syncBanner("The signed-in account changed. Reload before editing.",sync.mode,true);return;}
      if(sync.revision!==revision || sync.dirty || sync.saving || sync.mode!=="online" || wellnessDraft ||
          document.querySelector("dialog[open]") || document.activeElement?.matches("input, textarea, select"))return;
      if(payload.etag!==sync.etag){
        state=payload.state;sync.etag=payload.etag;render();syncBanner("Updated from the other browser");
      }
    } catch {
      if(sync.revision===revision && !sync.dirty && !sync.saving){
        sync.mode="error";editable(false);syncBanner("Sync connection lost. Reconnect before editing.",sync.mode,true);
      }
    } finally { sync.refreshing=false; }
  }
  function currentQuests() {return state.days[today] || [];}
  function currentBoss() {return state.bosses[week];}
  function totalStats() {
    const lanes={mind:0,build:0,body:0};
    let questCount=0;
    for(const quests of Object.values(state.days)) for(const q of quests) {
      if(q.done){questCount++;lanes[q.lane]+=XP_QUEST;}
    }
    const bossCount=Object.values(state.bosses).filter(b=>b.done).length;
    return {lanes,questCount,bossCount,xp:questCount*XP_QUEST+bossCount*XP_BOSS};
  }
  function streakDays() {
    let d=new Date(),count=0;
    if(!(state.days[localDate(d)] || []).some(q=>q.done))d.setDate(d.getDate()-1);
    for(let i=0;i<366;i++){
      if(!(state.days[localDate(d)] || []).some(q=>q.done))break;
      count++;d.setDate(d.getDate()-1);
    }
    return count;
  }
  function maybeRollover() {
    const nextDay=localDate(),nextWeek=isoWeek();
    if(today!==nextDay || week!==nextWeek){today=nextDay;week=nextWeek;render();toast("New day. Add up to three quests.");}
  }
  function renderStats() {
    const {lanes,questCount,bossCount,xp}=totalStats();
    const lvl=Math.floor(xp/XP_LEVEL)+1;
    const into=xp%XP_LEVEL;
    $("date-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
    $("hero-level").textContent=String(lvl).padStart(2,"0");
    $("level-sub").textContent=into+" / "+XP_LEVEL+" XP";
    $("level-ring").style.setProperty("--ring",(into/XP_LEVEL*100)+"%");
    $("total-xp").replaceChildren(document.createTextNode(String(xp)+" "),element("span","", "XP"));
    $("quest-count").replaceChildren(document.createTextNode(String(questCount)+" "),element("span","", "finished"));
    $("boss-count").replaceChildren(document.createTextNode(String(bossCount)+" "),element("span","", "cleared"));
    $("streak").replaceChildren(document.createTextNode(String(streakDays())+" "),element("span","", "days"));
    for(const lane of Object.keys(LANES)) {
      $(lane+"-xp").textContent=lanes[lane]+" XP";
      $(lane+"-bar").style.width=(lanes[lane]%XP_LEVEL)/XP_LEVEL*100+"%";
    }
  }
  function renderQuests() {
    const host=$("quest-list");host.replaceChildren();
    const quests=currentQuests(),done=quests.filter(q=>q.done).length;
    $("today-chip").textContent=done+" / 3 done";
    $("quest-progress-fill").style.width=done/3*100+"%";
    $("day-status").textContent=done===3?"All three complete. Day cleared.":done?done+" of 3 complete · "+done*XP_QUEST+" XP today":"Complete a quest to earn 25 XP.";
    $("today").dataset.complete=String(done===3);
    if(!quests.length)host.append(element("div","empty","Add your first quest below."));
    quests.forEach(q=>{
      const row=element("div","quest"+(q.done?" done":""));
      const input=document.createElement("input");input.type="checkbox";input.checked=q.done;input.setAttribute("aria-label","Complete "+q.title);
      input.addEventListener("change",()=>{
        const previousXP=totalStats().xp;q.done=input.checked;persist();render();
        if(q.done)reward(XP_QUEST,previousXP);else toast("Quest marked unfinished");
      });
      const main=element("div","quest-main");
      main.append(element("strong","",q.title),element("small","",LANES[q.lane].label+" · 25 XP"));
      const remove=element("button","delete-quest","×");remove.type="button";remove.setAttribute("aria-label","Remove "+q.title);
      remove.addEventListener("click",()=>{
        const day=today,index=currentQuests().findIndex(item=>item.id===q.id);
        state.days[day]=currentQuests().filter(item=>item.id!==q.id);persist();render();
        toast("Quest removed.",{label:"Undo",run:()=>{
          if(!["local","online"].includes(sync.mode)){toast("Reconnect before undoing.");return;}
          const quests=state.days[day] || [];
          if(quests.length>=3){toast("Three quests already added. Remove one before restoring.");return;}
          if(quests.some(item=>item.id===q.id))return;
          quests.splice(index,0,q);state.days[day]=quests;persist();render();toast("Quest restored.");
        }});
      });
      const edit=element("button","edit-quest","Edit");edit.type="button";edit.setAttribute("aria-label","Edit "+q.title);
      edit.addEventListener("click",async()=>{
        const title=await ask("Update this quest without changing its completion.",{value:q.title,maxLength:120});
        if(title===null || !title.trim())return;
        q.title=title.trim().slice(0,120);persist();render();
      });
      row.append(input,main,edit,remove);host.append(row);
    });
    const full=quests.length>=3;
    $("quest-title").disabled=full;$("quest-lane").disabled=full;$("add-quest").disabled=full;
    $("quest-title").placeholder=full?"Three quests added for today":"e.g. Solve five practice questions";
    document.querySelectorAll(".suggestion").forEach(b=>b.disabled=full);
  }
  function addQuest(title,lane) {
    title=title.trim();if(!title)return;
    if(currentQuests().length>=3){toast("Today already has three quests.");return;}
    if(!LANES[lane])return;
    if(!state.days[today])state.days[today]=[];
    state.days[today].push({id:String(Date.now())+"-"+String(Math.random()).slice(2,8),title:title.slice(0,120),lane,done:false});
    persist();render();toast("Quest added.");
  }
  function renderBoss() {
    const host=$("boss-box");host.replaceChildren();const boss=currentBoss();
    if(!boss || !boss.title) {
      const form=document.createElement("form");form.id="boss-form";
      const label=element("label","field-label","Weekly goal");label.htmlFor="boss-input";
      const row=element("div","boss-form-row");const input=document.createElement("input");input.id="boss-input";input.maxLength=160;input.required=true;input.placeholder="e.g. Finish the first playable scene";
      const btn=element("button","action-button","Set goal");btn.type="submit";
      row.append(input,btn);form.append(label,row);form.addEventListener("submit",e=>{
        e.preventDefault();const title=input.value.trim();if(!title)return;
        state.bosses[week]={title,done:false};persist();render();toast("Weekly goal added.");
      });host.append(form);return;
    }
    const row=element("div","boss-active");
    const left=element("div");left.append(element("small","",week+" · Weekly goal"),element("strong","",boss.title));
    const edit=element("button","edit-boss","Edit objective");
    edit.addEventListener("click",async()=>{
      const next=await ask("Editing a completed weekly objective marks it unfinished.",{value:boss.title});
      if(next===null)return;
      if(!next.trim())return;
      boss.title=next.trim().slice(0,160);boss.done=false;persist();render();
    });
    left.append(edit);
    const btn=element("button","boss-button"+(boss.done?" done":""),boss.done?"Completed":"Mark complete");
    btn.addEventListener("click",()=>{
      const previousXP=totalStats().xp;boss.done=!boss.done;persist();render();
      if(boss.done)reward(XP_BOSS,previousXP);else toast("Weekly goal reopened.");
    });
    row.append(left,btn);host.append(row);
  }
  function renderVault() {
    const list=$("vault-list");list.replaceChildren();
    if(!state.vault.length){list.append(element("li","empty-vault","No saved ideas."));return;}
    state.vault.forEach((text,i)=>{
      const li=element("li");li.append(element("span","",text));
      const b=element("button","","×");b.type="button";b.setAttribute("aria-label","Remove idea "+text);
      b.addEventListener("click",()=>{state.vault.splice(i,1);persist();renderVault();});
      li.append(b);list.append(li);
    });
  }
  function renderWellness() {
    if(wellnessDraft)return;
    const entry=(state.wellness[today] || []).find(e=>e.authorId===userId) || null;
    document.querySelectorAll('input[name="wellness-mood"]').forEach(input=>{
      input.checked=!!entry && input.value===entry.mood;
    });
    $("wellness-sleep").value=entry && entry.sleep!==null?String(entry.sleep):"";
    $("wellness-energy").value=entry?.energy || "";
    $("wellness-note").value=entry?.note || "";
    $("wellness-status").textContent=entry?(sync.mode==="local"?"Check-in saved in this browser.":"Check-in recorded. See sync status above."):"No check-in today.";
    const host=$("wellness-days");
    const opened=new Set(Array.from(host.querySelectorAll?.("details[open]") || []).map(n=>n.dataset.date));
    const firstRender=!host.childElementCount;
    host.replaceChildren();
    let count=0;
    for(let i=6;i>=0;i--){
      const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()-i);
      const key=localDate(date),logs=state.wellness[key] || [];
      const day=element(logs.length?"details":"div","wellness-day"+(logs.length?" recorded":" missing"));
      day.dataset.date=key;
      const summary=element(logs.length?"summary":"div","day-summary");
      summary.append(element("strong","",date.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"})),
        element("span","",logs.length?logs.length+(logs.length===1?" entry":" entries"):"No entry"));
      day.append(summary);
      if(logs.length)day.open=opened.has(key) || (firstRender && i===0);
      for(const log of logs){
        const record=element("div","wellness-entry");
        const who=log.authorId===null?"Earlier entry (author unknown)":log.authorId===userId?"You":"Other person";
        record.append(element("strong","",who));
        const facts=[log.mood?"Mood: "+log.mood:"",log.sleep!==null?log.sleep+"h sleep":"",log.energy?"Energy: "+log.energy:""].filter(Boolean);
        if(facts.length)record.append(element("small","",facts.join(" · ")));
        if(log.note)record.append(element("span","wellness-history-note",log.note));
        day.append(record);count++;
      }
      host.append(day);
    }
    $("wellness-count").textContent=count+(count===1?" entry":" entries");
  }
  function weekStart(key) {
    const year=Number(key.slice(0,4)),weekNumber=Number(key.slice(6));
    const d=new Date(Date.UTC(year,0,4));
    d.setUTCDate(d.getUTCDate()-(d.getUTCDay() || 7)+1+(weekNumber-1)*7);
    return d.toISOString().slice(0,10);
  }
  function renderWins() {
    const host=$("recent-wins");host.replaceChildren();
    const entries=[];
    for(const [date,quests] of Object.entries(state.days))for(const q of quests)
      if(q.done)entries.push({date,title:q.title,sub:LANES[q.lane].label+" · 25 XP"});
    for(const [date,boss] of Object.entries(state.bosses))
      if(boss.done)entries.push({date,title:boss.title,sortDate:weekStart(date),sub:"Weekly goal · 100 XP"});
    entries.sort((a,b)=>(b.sortDate || b.date).localeCompare(a.sortDate || a.date));
    if(!entries.length){host.append(element("div","empty","Completed quests and weekly goals will appear here."));return;}
    entries.slice(0,6).forEach(item=>{
      const row=element("div","win-row");const text=element("div");
      text.append(element("div","",item.title),element("small","",item.date+" · "+item.sub));
      row.append(element("div","check","✓"),text);host.append(row);
    });
  }
  let reviewOffset=0,reviewSelected=null;
  function reviewSummary(anchor){
    const start=new Date(anchor);start.setHours(12,0,0,0);start.setDate(start.getDate()-(start.getDay()+6)%7);
    const days=Array.from({length:7},(_,i)=>{
      const date=new Date(start);date.setDate(date.getDate()+i);
      const key=localDate(date),quests=state.days[key] || [];
      return {date,key,quests,done:quests.filter(q=>q.done).length};
    });
    const goal=state.bosses[isoWeek(start)] || null;
    const done=days.reduce((n,d)=>n+d.done,0),planned=days.reduce((n,d)=>n+d.quests.length,0);
    return {days,goal,done,planned,active:days.filter(d=>d.done>0).length,xp:done*XP_QUEST+(goal?.done?XP_BOSS:0)};
  }
  function renderReview(){
    const anchor=new Date();anchor.setDate(anchor.getDate()+reviewOffset*7);
    const summary=reviewSummary(anchor),{days,goal}=summary;
    if(!days.some(d=>d.key===reviewSelected))reviewSelected=reviewOffset===0?today:days[0].key;
    const format=d=>d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
    $("review-range").textContent=format(days[0].date)+" – "+format(days[6].date);
    $("review-next").disabled=reviewOffset===0;$("review-current").disabled=reviewOffset===0;
    const totals=$("review-totals");totals.replaceChildren();
    for(const [label,value] of [["Quests completed",summary.done+" / "+summary.planned],["XP earned",summary.xp],["Days with a completion",summary.active+" / 7"]]){
      const item=element("div");item.append(element("span","",label),element("strong","",String(value)));totals.append(item);
    }
    const chart=$("review-days");chart.replaceChildren();
    for(const day of days){
      const button=element("button","review-day"+(day.key===reviewSelected?" selected":""));button.type="button";
      button.setAttribute("aria-pressed",String(day.key===reviewSelected));
      button.setAttribute("aria-label",format(day.date)+": "+day.done+" of "+day.quests.length+" quests completed");
      const track=element("span","review-track"),bar=element("span","review-bar");bar.style.height=day.done/3*100+"%";track.append(bar);track.setAttribute("aria-hidden","true");
      button.append(element("strong","",String(day.done)),track,element("span","",day.date.toLocaleDateString(undefined,{weekday:"short"})),element("small","",String(day.date.getDate())));
      button.addEventListener("click",()=>{reviewSelected=day.key;renderReview();const buttons=$("review-days").children;buttons[days.indexOf(day)]?.focus({preventScroll:true});});chart.append(button);
    }
    const selected=days.find(d=>d.key===reviewSelected) || days[0];
    $("review-day-title").textContent=format(selected.date);
    const tasks=$("review-tasks");tasks.replaceChildren();
    if(!selected.quests.length)tasks.append(element("li","review-empty",selected.key>today?"No tasks recorded for this date.":"No quests recorded for this day."));
    for(const q of selected.quests){
      const li=element("li",q.done?"review-finished":"");
      li.append(element("span","",q.title),element("small","",(q.done?"Completed · 25 XP":"Not completed")+" · "+LANES[q.lane].label));tasks.append(li);
    }
    const goalHost=$("review-goal");goalHost.replaceChildren(element("h3","","Weekly goal"));
    goalHost.append(element("p","",goal?.title || "No weekly goal recorded."));
    if(goal)goalHost.append(element("span",goal.done?"review-goal-done":"review-caption",goal.done?"Completed · 100 XP":"Not completed · 0 XP"));
  }
  $("review-prev").addEventListener("click",()=>{reviewOffset--;reviewSelected=null;renderReview();});
  $("review-next").addEventListener("click",()=>{if(reviewOffset<0){reviewOffset++;reviewSelected=null;renderReview();}});
  $("review-current").addEventListener("click",()=>{reviewOffset=0;reviewSelected=null;renderReview();});
  function render() { renderStats();renderQuests();renderBoss();renderWellness();renderVault();renderWins();renderReview(); }
  function renderClock() {
    const m=Math.floor(timerRemaining/60),s=timerRemaining%60;
    $("timer").textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    $("timer-toggle").textContent=timerRunning?"Pause":timerRemaining===0?"Restart":"Start";
    $("focus").dataset.running=String(timerRunning);
    document.querySelectorAll(".preset").forEach(b=>{b.classList.toggle("selected",Number(b.dataset.minutes)===timerMinutes);b.disabled=timerRunning;});
  }
  function tick() {
    if(timerRunning){
      timerRemaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));
      if(timerRemaining===0){timerRunning=false;timerEnd=null;toast("Focus session finished.");}
      renderClock();
    }
    maybeRollover();
  }
  function exportBackup() {
    const blob=new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),...state},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="ascend-backup-"+today+".json";document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);toast("Backup downloaded.");
  }
  async function importBackup(raw) {
    if(sync.mode==="checking" || sync.mode==="error" || sync.mode==="conflict") {
      toast("Reconnect shared sync before importing. You can still export a backup.");
      return;
    }
    const imported=fromBackup(raw);
    if(sync.saving){toast("Wait for the current save before importing.");return;}
    if(!await ask(sync.mode==="online"?"Replace shared ASCEND progress for both people with this backup?":"Replace progress in this browser with the imported backup?",{phrase:"REPLACE SHARED PROFILE"}))return;
    sync.operation="restore";sync.confirmation="REPLACE SHARED PROFILE";
    state=imported;wellnessDraft=false;
    persist();render();toast(sync.mode==="online"?"Shared backup queued for sync.":"Backup restored.");
  }
  document.querySelectorAll(".side-link").forEach(link=>link.addEventListener("click",()=>{
    document.querySelectorAll(".side-link").forEach(n=>{n.classList.toggle("active",n===link);n.setAttribute("aria-current",n===link?"location":"false");});
  }));
  $("wellness-form").addEventListener("input",()=>{wellnessDraft=true;});
  $("wellness-form").addEventListener("change",()=>{wellnessDraft=true;});
  $("wellness-form").addEventListener("submit",e=>{
    e.preventDefault();
    const mood=document.querySelector('input[name="wellness-mood"]:checked')?.value || "";
    const sleepText=$("wellness-sleep").value.trim();
    const sleep=sleepText===""?null:Number(sleepText);
    const energy=$("wellness-energy").value;
    const note=$("wellness-note").value.trim().slice(0,180);
    if(sleep!==null && (!Number.isFinite(sleep) || sleep<0 || sleep>24)){toast("Please enter a sleep duration between 0 and 24 hours, or leave it blank.");return;}
    if(!mood && sleep===null && !energy && !note){toast("Choose at least one thing to check in about.");return;}
    wellnessDraft=false;
    const records=state.wellness[today] || [];
    state.wellness[today]=[...records.filter(e=>e.authorId!==userId),{authorId:userId,mood,sleep,energy,note}];
    persist();renderWellness();toast(sync.mode==="online"?"Check-in queued for sync.":"Check-in saved in this browser.");
  });
  $("quest-form").addEventListener("submit",e=>{
    e.preventDefault();addQuest($("quest-title").value,$("quest-lane").value);$("quest-title").value="";
  });
  const examples={
    mind:"Solve five practice questions",
    build:"Test one feature",
    body:"Go for a walk"
  };
  document.querySelectorAll(".suggestion").forEach(b=>b.addEventListener("click",()=>addQuest(examples[b.dataset.suggestion],b.dataset.suggestion)));
  $("vault-form").addEventListener("submit",e=>{
    e.preventDefault();const text=$("vault-input").value.trim();
    if(!text)return;if(state.vault.length>=100){toast("Idea vault is full. Review older ideas.");return;}
    state.vault.push(text.slice(0,140));$("vault-input").value="";persist();renderVault();toast("Idea saved.");
  });
  document.querySelectorAll(".preset").forEach(b=>b.addEventListener("click",()=>{
    if(timerRunning)return;timerMinutes=Number(b.dataset.minutes);timerRemaining=timerMinutes*60;renderClock();
  }));
  $("timer-toggle").addEventListener("click",()=>{
    if(timerRunning){timerRemaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));timerRunning=false;timerEnd=null;}
    else{if(timerRemaining===0)timerRemaining=timerMinutes*60;timerRunning=true;timerEnd=Date.now()+timerRemaining*1000;}
    renderClock();
  });
  $("timer-reset").addEventListener("click",()=>{
    timerRunning=false;timerEnd=null;timerRemaining=timerMinutes*60;renderClock();
  });
  $("export").addEventListener("click",exportBackup);
  document.querySelector('label[for="import-file"]')?.addEventListener("keydown",e=>{
    if(e.key==="Enter" || e.key===" "){e.preventDefault();$("import-file").click();}
  });
  $("import-file").addEventListener("change",async e=>{
    const f=e.target.files?.[0];e.target.value="";if(!f)return;
    if(f.size>2_000_000){toast("Backup must be under 2 MB.");return;}
    try{await importBackup(JSON.parse(await f.text()));}catch{toast("That backup could not be imported.");}
  });
  $("reset-data").addEventListener("click",async()=>{
    if(sync.mode==="checking" || sync.mode==="error" || sync.mode==="conflict") {
      toast("Reconnect shared sync before resetting data.");
      return;
    }
    if(sync.saving){toast("Wait for the current save before resetting.");return;}
    if(!await ask(sync.mode==="online"?
      "Reset EVERYTHING for both authorized users, including shared wellness? Export a backup first.":
      "Delete all local ASCEND quests, XP, wellness, wins, and ideas? Export a backup first.",{phrase:"RESET SHARED PROFILE"}))return;
    sync.operation="reset";sync.confirmation="RESET SHARED PROFILE";
    wellnessDraft=false;state=blank();persist();render();toast("ASCEND reset queued.");
  });
  window.addEventListener("beforeunload",e=>{
    if(sync.dirty || sync.saving || wellnessDraft){e.preventDefault();e.returnValue="";}
  });
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){maybeRollover();refreshShared();}});
  window.addEventListener("online",()=>{if(sync.mode==="error" && !sync.dirty)initializeSync();});
  setInterval(tick,500);
  render();renderClock();
  initializeSync();
  setInterval(refreshShared,15000);

  // A self-contained break game. It never reads or changes quest progress.
  const dot=$("game-dot"),gameStart=$("game-start"),board=$("dot-board");
  let gameEnd=0,gameScore=0,gameCell=0,gameLoop=null;
  let gameBest=0;
  try { const saved=Number(localStorage.getItem(KEY+"-dot-best"));if(Number.isSafeInteger(saved) && saved>=0)gameBest=saved; } catch {}
  $("game-status").textContent="Best: "+gameBest+" · Press Play. Keyboard: Enter or Space catches the dot.";
  function moveDot(){
    gameCell=(gameCell+1+Math.floor(Math.random()*11))%12;
    dot.style.left=((gameCell%4+.5)*25)+"%";
    dot.style.top=((Math.floor(gameCell/4)+.5)*100/3)+"%";
  }
  function finishGame(){
    gameEnd=0;clearInterval(gameLoop);gameLoop=null;
    dot.hidden=true;dot.disabled=true;board.dataset.running="false";
    $("game-time").textContent="0";gameStart.disabled=false;gameStart.textContent="Play again";
    const record=gameScore>gameBest;
    if(record){gameBest=gameScore;try{localStorage.setItem(KEY+"-dot-best",String(gameBest));}catch{}}
    $("game-status").textContent="Time! You caught "+gameScore+(gameScore===1?" dot.":" dots.")+(record?" New personal best!":" Best: "+gameBest+".")+" Another round?";
    if(document.activeElement===dot)gameStart.focus({preventScroll:true});
  }
  function gameTick(){
    if(!gameEnd)return;
    const remaining=Math.max(0,Math.ceil((gameEnd-Date.now())/1000));
    $("game-time").textContent=String(remaining);
    if(!remaining)finishGame();
  }
  gameStart.addEventListener("click",()=>{
    if(gameEnd)return;
    gameScore=0;gameEnd=Date.now()+20000;
    $("game-score").textContent="0";$("game-time").textContent="20";
    $("game-status").textContent="Go! Catch the dot. Best: "+gameBest+".";
    gameStart.disabled=true;dot.disabled=false;dot.hidden=false;board.dataset.running="true";
    moveDot();dot.focus({preventScroll:true});gameLoop=setInterval(gameTick,100);
  });
  dot.addEventListener("click",()=>{
    if(!gameEnd)return;
    if(Date.now()>=gameEnd){finishGame();return;}
    $("game-score").textContent=String(++gameScore);moveDot();
  });
  document.addEventListener("visibilitychange",gameTick);
})();
