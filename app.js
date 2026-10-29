(() => {
  "use strict";
  const KEY = "ascend-questboard-v1";
  const XP_QUEST = 25;
  const XP_BOSS = 100;
  const XP_LEVEL = 150;
  const LANES = {
    mind: { label: "LEARN", symbol: "◈" },
    build: { label: "BUILD", symbol: "⚡" },
    body: { label: "BODY", symbol: "♥" }
  };
  const $ = id => document.getElementById(id);
  function blank() { return { days: {}, bosses: {}, vault: [] }; }
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
    try {
      const v=JSON.parse(localStorage.getItem(KEY) || "null");
      if(!v || typeof v !== "object" || Array.isArray(v)) return blank();
      const safe=blank();
      if(v.days && typeof v.days==="object" && !Array.isArray(v.days)) {
        for(const [date,quests] of Object.entries(v.days).slice(-500)) {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(quests)) continue;
          safe.days[date]=quests.slice(0,3).filter(q=>q && typeof q.title==="string" && LANES[q.lane]).map(q=>({id:String(q.id),title:q.title.slice(0,120),lane:q.lane,done:!!q.done}));
        }
      }
      if(v.bosses && typeof v.bosses==="object" && !Array.isArray(v.bosses)) {
        for(const [week,boss] of Object.entries(v.bosses).slice(-100)) {
          if(!/^\d{4}-W\d{2}$/.test(week) || !boss || typeof boss.title !== "string") continue;
          safe.bosses[week]={title:boss.title.slice(0,160),done:!!boss.done};
        }
      }
      if(Array.isArray(v.vault)) safe.vault=v.vault.filter(s=>typeof s==="string").slice(0,100).map(s=>s.slice(0,140));
      return safe;
    } catch { return blank(); }
  }
  let state=read(), today=localDate(), week=isoWeek();
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
    try { localStorage.setItem(KEY,JSON.stringify(state)); }
    catch { if(!storageWarned){toast("Storage is disabled. Export your progress.");storageWarned=true;} }
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
      row.append(input,main,remove);host.append(row);
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
  function render() { renderStats();renderQuests();renderBoss();renderVault();renderWins(); }
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
    const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="ascend-backup-"+today+".json";document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);toast("Backup downloaded.");
  }
  function importBackup(raw) {
    if(!raw || typeof raw!=="object" || Array.isArray(raw) || !raw.days || !raw.bosses || !Array.isArray(raw.vault))throw new Error("Invalid backup");
    if(!confirm("Replace all progress in this browser with the imported backup?"))return;
    localStorage.setItem(KEY,JSON.stringify(raw));state=read();render();toast("Backup restored.");
  }
  document.querySelectorAll(".side-link").forEach(link=>link.addEventListener("click",()=>{
    document.querySelectorAll(".side-link").forEach(n=>n.classList.toggle("active",n===link));
  }));
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
    if(!confirm("Delete all local ASCEND quests, XP, wins, and ideas? Export a backup first if you want to keep them."))return;
    state=blank();persist();render();toast("ASCEND reset.");
  });
  setInterval(tick,500);
  render();renderClock();
})();
