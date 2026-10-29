import { validState, blank, fromBackup } from "./state.mjs";
(() => {
  "use strict";
  const KEY = "ascend-questboard-v1";
  const SHARED_API = "/api/shared";
  const XP_QUEST = 25;
  const XP_BOSS = 100;
  const XP_LEVEL = 150;
  const LANES = {
    mind: { label: "LEARN", symbol: "◈" },
    build: { label: "BUILD", symbol: "⚡" },
    body: { label: "BODY", symbol: "♥" }
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
  let state=blank(), today=localDate(), week=isoWeek(), wellnessDraft=false;
  const sync={mode:"checking",etag:null,saving:false,dirty:false,timer:null,revision:0,refreshing:false};
  function readDraft() {
    try {
      const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && validState(draft.state) && (draft.etag===null || /^[a-f0-9]{32}$/.test(draft.etag)) ? draft : null;
    } catch { return null; }
  }
  function retainDraft() {
    try { sessionStorage.setItem(DRAFT_KEY,JSON.stringify({etag:sync.etag,state})); }
    catch { toast("This browser cannot keep an unsaved draft. Keep this tab open or export a backup."); }
  }
  function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch {} }
  function editable(value) {
    document.querySelectorAll(".card").forEach(card=>{if(card.id!=="focus")card.inert=!value;});
  }
  function validPayload(p) {
    return p && Object.hasOwn(p,"etag") && (p.etag===null || (typeof p.etag==="string" && /^[a-f0-9]{32}$/.test(p.etag))) && validState(p.state);
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
  function toast(text) {
    const n=$("toast");n.textContent=text;n.classList.add("show");
    clearTimeout(toastHandle);toastHandle=setTimeout(()=>n.classList.remove("show"),3200);
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
    $("privacy-label").textContent=mode==="online"?"● Private shared profile":mode==="local"?"● Browser-only mode":"● Shared sync unavailable";
    if(sync.dirty || mode==="conflict"){
      const backup=element("button","","Export unsaved backup");backup.type="button";
      backup.addEventListener("click",exportBackup);banner.append(backup);
    }
    if(mode==="conflict"){
      const latest=element("button","","Load latest shared profile");latest.type="button";
      latest.addEventListener("click",()=>{
        if(!confirm("Discard this tab's unsaved changes and load the latest shared profile? Export your unsaved backup first."))return;
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
    const revision=sync.revision,snapshot=JSON.stringify(state);
    syncBanner("Saving shared progress…");
    try {
      const response=await requestShared({
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({etag:sync.etag,state:JSON.parse(snapshot)})
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
      sync.dirty=sync.revision!==revision;
      if(sync.dirty)retainDraft();else clearDraft();
      syncBanner(sync.dirty?"Saving remaining changes…":"✓ Synced securely · Shared with authorized visitors");
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
      sync.etag=payload.etag;sync.mode="online";
      if(draft && JSON.stringify(draft.state)!==JSON.stringify(payload.state)) {
        state=draft.state;sync.dirty=true;render();
        if(draft.etag!==payload.etag){
          sync.etag=draft.etag;sync.mode="conflict";editable(false);
          syncBanner("A draft from this tab conflicts with newer shared progress. Export it, then load the latest profile.",sync.mode);return;
        }
        editable(true);scheduleSave();syncBanner("Recovered this tab's unsaved changes. Retrying secure sync…");return;
      }
      clearDraft();sync.dirty=false;state=payload.state;render();editable(true);
      syncBanner("✓ Connected · Private shared progress is up to date");
      if(payload.etag===null && hasProgress(localState) &&
          confirm("Upload this browser's existing ASCEND progress, including wellness, to the shared profile for both authorized people?")) {
        state=localState;render();persist();
      }
    } catch {
      const draft=readDraft();if(draft){state=draft.state;sync.etag=draft.etag;sync.dirty=true;render();}
      sync.mode="error";editable(false);
      syncBanner("Private sync is unavailable. Reconnect before editing. Unsaved changes can be exported.",sync.mode,true);
    }
  }
  async function refreshShared() {
    if(sync.mode!=="online" || sync.saving || sync.dirty || sync.refreshing || document.hidden || wellnessDraft ||
        document.activeElement?.matches("input, textarea, select"))return;
    const revision=sync.revision;sync.refreshing=true;
    try {
      const response=await requestShared();
      if(!response.ok)throw new Error("Refresh failed");
      const payload=await response.json();
      if(!validPayload(payload))throw new Error("Invalid shared profile");
      // Edits or a save made while GET was in flight always win locally.
      if(sync.revision!==revision || sync.dirty || sync.saving || sync.mode!=="online" || wellnessDraft ||
          document.activeElement?.matches("input, textarea, select"))return;
      if(payload.etag!==sync.etag){
        state=payload.state;sync.etag=payload.etag;render();syncBanner("✓ Updated with progress from the other browser");
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
    if(today!==nextDay || week!==nextWeek){today=nextDay;week=nextWeek;render();toast("New day. Choose up to three meaningful quests.");}
  }
  function renderStats() {
    const {lanes,questCount,bossCount,xp}=totalStats();
    const lvl=Math.floor(xp/XP_LEVEL)+1;
    const into=xp%XP_LEVEL;
    $("date-label").textContent=new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}).toUpperCase();
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
    $("today-chip").textContent=done+" / 3 DONE";
    $("quest-progress-fill").style.width=done/3*100+"%";
    if(!quests.length)host.append(element("div","empty","Your questboard is empty. Pick one outcome you can finish today."));
    quests.forEach(q=>{
      const row=element("div","quest"+(q.done?" done":""));
      const input=document.createElement("input");input.type="checkbox";input.checked=q.done;input.setAttribute("aria-label","Complete "+q.title);
      input.addEventListener("change",()=>{q.done=input.checked;persist();render();toast(q.done?"+25 XP · Quest finished":"Quest marked unfinished");});
      const main=element("div","quest-main");
      main.append(element("strong","",q.title),element("small","",LANES[q.lane].symbol+" "+LANES[q.lane].label+" · +25 XP"));
      const remove=element("button","delete-quest","×");remove.type="button";remove.setAttribute("aria-label","Remove "+q.title);
      remove.addEventListener("click",()=>{state.days[today]=currentQuests().filter(item=>item.id!==q.id);persist();render();toast("Quest removed.");});
      const edit=element("button","edit-quest","Edit");edit.type="button";edit.setAttribute("aria-label","Edit "+q.title);
      edit.addEventListener("click",()=>{
        const title=prompt("Edit this quest:",q.title);
        if(title===null || !title.trim())return;
        q.title=title.trim().slice(0,120);persist();render();
      });
      row.append(input,main,edit,remove);host.append(row);
    });
    const full=quests.length>=3;
    $("quest-title").disabled=full;$("quest-lane").disabled=full;$("add-quest").disabled=full;
    $("quest-title").placeholder=full?"Three quests chosen. Time to execute.":"e.g. Finish one working enemy AI mechanic";
    document.querySelectorAll(".suggestion").forEach(b=>b.disabled=full);
  }
  function addQuest(title,lane) {
    title=title.trim();if(!title)return;
    if(currentQuests().length>=3){toast("Three quests max. Finish what you chose.");return;}
    if(!LANES[lane])return;
    if(!state.days[today])state.days[today]=[];
    state.days[today].push({id:String(Date.now())+"-"+String(Math.random()).slice(2,8),title:title.slice(0,120),lane,done:false});
    persist();render();toast("Quest added. Now make it happen.");
  }
  function renderBoss() {
    const host=$("boss-box");host.replaceChildren();const boss=currentBoss();
    if(!boss || !boss.title) {
      const form=document.createElement("form");form.id="boss-form";
      const label=element("label","field-label","THIS WEEK'S WIN CONDITION");label.htmlFor="boss-input";
      const row=element("div","boss-form-row");const input=document.createElement("input");input.id="boss-input";input.maxLength=160;input.required=true;input.placeholder="What will exist by the end of the week?";
      const btn=element("button","action-button","Set boss ↗");btn.type="submit";
      row.append(input,btn);form.append(label,row);form.addEventListener("submit",e=>{
        e.preventDefault();const title=input.value.trim();if(!title)return;
        state.bosses[week]={title,done:false};persist();render();toast("Weekly boss set.");
      });host.append(form);return;
    }
    const row=element("div","boss-active");
    const left=element("div");left.append(element("small","",week+" · WEEKLY WIN CONDITION"),element("strong","",boss.title));
    const edit=element("button","edit-boss","Edit objective");
    edit.addEventListener("click",()=>{
      const next=prompt("Edit this week's win condition:",boss.title);
      if(next===null)return;
      if(!next.trim())return;
      boss.title=next.trim().slice(0,160);boss.done=false;persist();render();
    });
    left.append(edit);
    const btn=element("button","boss-button"+(boss.done?" done":""),boss.done?"✓ Boss defeated":"Defeat boss ↗");
    btn.addEventListener("click",()=>{boss.done=!boss.done;persist();render();toast(boss.done?"+100 XP · You shipped a real outcome.":"Boss marked unfinished.");});
    row.append(left,btn);host.append(row);
  }
  function renderVault() {
    const list=$("vault-list");list.replaceChildren();
    if(!state.vault.length){list.append(element("li","empty-vault","No distractions parked yet. Protect your focus when the next idea arrives."));return;}
    state.vault.forEach((text,i)=>{
      const li=element("li");li.append(element("span","",text));
      const b=element("button","","×");b.type="button";b.setAttribute("aria-label","Remove idea "+text);
      b.addEventListener("click",()=>{state.vault.splice(i,1);persist();renderVault();});
      li.append(b);list.append(li);
    });
  }
  const moods={rough:"😞",low:"😕",okay:"😐",good:"🙂",great:"😄"};
  function renderWellness() {
    if(wellnessDraft)return;
    const entry=state.wellness[today] || null;
    document.querySelectorAll('input[name="wellness-mood"]').forEach(input=>{
      input.checked=!!entry && input.value===entry.mood;
    });
    $("wellness-sleep").value=entry && entry.sleep!==null?String(entry.sleep):"";
    $("wellness-energy").value=entry?.energy || "";
    $("wellness-note").value=entry?.note || "";
    $("wellness-status").textContent=entry?"Today's check-in is saved. You can update it.":"Nothing recorded today.";

    const host=$("wellness-days");host.replaceChildren();
    let count=0;
    for(let i=6;i>=0;i--){
      const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()-i);
      const key=localDate(date),log=state.wellness[key],day=element("div","wellness-day"+(log?" recorded":" missing"));
      day.append(element("strong","",date.toLocaleDateString(undefined,{weekday:"short"})));
      day.append(element("span","mood-face",log?(moods[log.mood] || "♡"):"·"));
      day.append(element("small","",log?(log.sleep!==null?log.sleep+"h sleep":(log.energy?log.energy+" energy":"Noted")):"—"));
      const detail=log?[log.mood?"Mood: "+log.mood:"",log.sleep!==null?"Sleep: "+log.sleep+" hours":"",log.energy?"Energy: "+log.energy:"",log.note].filter(Boolean).join(" · "):"No check-in";
      day.setAttribute("aria-label",date.toDateString()+": "+detail);
      if(log)count++;
      host.append(day);
    }
    $("wellness-count").textContent=count+" / 7 CHECK-INS";
  }
  function renderWins() {
    const host=$("recent-wins");host.replaceChildren();
    const entries=[];
    for(const [date,quests] of Object.entries(state.days))for(const q of quests)
      if(q.done)entries.push({date,title:q.title,sub:LANES[q.lane].label+" · +25 XP"});
    for(const [date,boss] of Object.entries(state.bosses))
      if(boss.done)entries.push({date,title:boss.title,sub:"WEEKLY BOSS · +100 XP"});
    entries.sort((a,b)=>b.date.localeCompare(a.date));
    if(!entries.length){host.append(element("div","empty","Your proof of progress appears here after the first finished quest."));return;}
    entries.slice(0,6).forEach(item=>{
      const row=element("div","win-row");const text=element("div");
      text.append(element("div","",item.title),element("small","",item.date+" · "+item.sub));
      row.append(element("div","check","✓"),text);host.append(row);
    });
  }
  function render() { renderStats();renderQuests();renderBoss();renderWellness();renderVault();renderWins(); }
  function renderClock() {
    const m=Math.floor(timerRemaining/60),s=timerRemaining%60;
    $("timer").textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    $("timer-toggle").textContent=timerRunning?"Pause":timerRemaining===0?"Restart ↗":"Start focus ↗";
    document.querySelectorAll(".preset").forEach(b=>{b.classList.toggle("selected",Number(b.dataset.minutes)===timerMinutes);b.disabled=timerRunning;});
  }
  function tick() {
    if(timerRunning){
      timerRemaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));
      if(timerRemaining===0){timerRunning=false;timerEnd=null;toast("Focus sprint finished! Record a real outcome to earn XP.");}
      renderClock();
    }
    maybeRollover();
  }
  function exportBackup() {
    const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),...state},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="ascend-backup-"+today+".json";document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);toast("Backup downloaded.");
  }
  function importBackup(raw) {
    if(sync.mode==="checking" || sync.mode==="error" || sync.mode==="conflict") {
      toast("Reconnect shared sync before importing. You can still export a backup.");
      return;
    }
    const imported=fromBackup(raw);
    if(!confirm(sync.mode==="online"?"Replace shared ASCEND progress for both people with this backup?":"Replace progress in this browser with the imported backup?"))return;
    state=imported;wellnessDraft=false;
    persist();render();toast(sync.mode==="online"?"Shared backup queued for sync.":"Backup restored.");
  }
  document.querySelectorAll(".side-link").forEach(link=>link.addEventListener("click",()=>{
    document.querySelectorAll(".side-link").forEach(n=>n.classList.toggle("active",n===link));
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
    wellnessDraft=false;state.wellness[today]={mood,sleep,energy,note};
    persist();renderWellness();toast(sync.mode==="online"?"Wellness queued for shared sync. No XP needed.":"Wellness saved in this browser. No XP needed.");
  });
  $("quest-form").addEventListener("submit",e=>{
    e.preventDefault();addQuest($("quest-title").value,$("quest-lane").value);$("quest-title").value="";
  });
  const examples={
    mind:"Solve five challenging questions without copying answers",
    build:"Finish and test one working game mechanic",
    body:"Complete a workout or a meaningful walk"
  };
  document.querySelectorAll(".suggestion").forEach(b=>b.addEventListener("click",()=>addQuest(examples[b.dataset.suggestion],b.dataset.suggestion)));
  $("vault-form").addEventListener("submit",e=>{
    e.preventDefault();const text=$("vault-input").value.trim();
    if(!text)return;if(state.vault.length>=100){toast("Idea vault is full. Review older ideas.");return;}
    state.vault.push(text.slice(0,140));$("vault-input").value="";persist();renderVault();toast("Idea parked. Back to your current quest.");
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
  $("import-file").addEventListener("change",async e=>{
    const f=e.target.files?.[0];e.target.value="";if(!f)return;
    if(f.size>2_000_000){toast("Backup must be under 2 MB.");return;}
    try{importBackup(JSON.parse(await f.text()));}catch{toast("That backup could not be imported.");}
  });
  $("reset-data").addEventListener("click",()=>{
    if(sync.mode==="checking" || sync.mode==="error" || sync.mode==="conflict") {
      toast("Reconnect shared sync before resetting data.");
      return;
    }
    if(!confirm(sync.mode==="online"?
      "Reset EVERYTHING for both authorized users, including shared wellness? Export a backup first.":
      "Delete all local ASCEND quests, XP, wellness, wins, and ideas? Export a backup first."))return;
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
})();
