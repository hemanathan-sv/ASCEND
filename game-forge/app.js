(() => {
  "use strict";

  const STORAGE_KEY = "game-forge-workspace-v1";
  const emptyState = () => ({ project: null, tasks: [], checks: {}, journal: "", parking: [] });
  const $ = id => document.getElementById(id);
  const checkItems = [
    ["launch", "Starts without errors", "The game launches and loads the first playable scene."],
    ["controls", "Controls respond correctly", "Movement, interaction, and pause work as intended."],
    ["goal", "The player knows what to do", "A new player understands the objective without your explanation."],
    ["win", "Victory is reachable", "You can complete the intended challenge end to end."],
    ["loss", "Failure and retry work", "Losing, restarting, and repeated attempts do not break state."],
    ["ai", "The intelligent system is observable", "Two different player actions produce a meaningful, explainable difference."],
    ["offline", "Network failures are handled", "If an external AI call fails, the game stays playable and secrets remain server-side."],
    ["save", "Progress survives a restart", "If the prototype has saves, verify loading; otherwise mark this after deciding saves are out of scope."]
  ];

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return emptyState();
      const state = emptyState();
      if (saved.project && typeof saved.project === "object" && typeof saved.project.name === "string") {
        state.project = {
          name: saved.project.name.slice(0, 60),
          idea: String(saved.project.idea || "").slice(0, 800),
          genre: String(saved.project.genre || "Adventure / RPG"),
          platform: String(saved.project.platform || "Desktop"),
          ai: String(saved.project.ai || "NPC memory and reactive dialogue")
        };
      }
      if (Array.isArray(saved.tasks)) state.tasks = saved.tasks.filter(t => t && typeof t.id === "string" && typeof t.text === "string" && typeof t.phase === "string").slice(0, 100).map(t => ({...t,done:!!t.done}));
      if (saved.checks && typeof saved.checks === "object") state.checks = saved.checks;
      if (typeof saved.journal === "string") state.journal = saved.journal.slice(0, 50000);
      if (Array.isArray(saved.parking)) state.parking = saved.parking.filter(v => typeof v === "string").slice(0, 100);
      return state;
    } catch { return emptyState(); }
  }
  let state = loadState();
  let activeAgent = "builder";
  let toastTimer;
  let storageWarned = false;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { if (!storageWarned) { notify("Browser storage unavailable. Export a backup before leaving."); storageWarned = true; } }
  }
  function notify(message) {
    const t = $("toast"); t.textContent = message; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
  }
  function el(tag, className, text) {
    const n = document.createElement(tag); if (className) n.className = className;
    if (text !== undefined) n.textContent = text; return n;
  }
  function percentage() {
    return state.tasks.length ? Math.round(state.tasks.filter(t => t.done).length / state.tasks.length * 100) : 0;
  }
  function nextTask() { return state.tasks.find(t => !t.done); }

  function createPlan(project) {
    const aiDetail = {
      "NPC memory and reactive dialogue": ["Track two player decisions in persistent game state", "Make one NPC's response change based on those decisions", "Show the player that their choices were remembered"],
      "Enemies that adapt to player behavior": ["Track one player behavior, such as repeated dodging", "Create two understandable enemy tactics based on that behavior", "Make tactic changes visible and fair to the player"],
      "Dynamic quests shaped by player choices": ["Add one choice with two meaningful outcomes", "Create two quest branches driven by the saved choice", "Show the consequence when the player returns"],
      "Autonomous characters with routines": ["Give one NPC a simple daily state machine", "Make its location or task change with world events", "Let the player interact and observe its current goal"],
      "Procedural encounters with adaptive difficulty": ["Track player success and failure across attempts", "Generate two encounter variations with bounded difficulty", "Explain changes through readable gameplay feedback"]
    }[project.ai] || ["Record one meaningful game-state event", "Make an intelligent system respond to that event", "Prove the response changes gameplay"];
    const phases = [
      ["01", "Core loop", ["Create a playable room or arena with basic movement and interaction", "Give the player one clear objective and visible feedback", "Implement a complete success, failure, and retry loop"]],
      ["02", "AI proof", aiDetail],
      ["03", "Game feel", ["Add clear visual feedback for actions and consequences", "Keep controls readable on the target platform", "Add a title screen and an understandable restart flow"]],
      ["04", "Playable build", ["Test the winning path and the losing path", "Fix the biggest reproducible bug from actual playtesting", "Export a build and ask someone else to play it"]]
    ];
    return phases.flatMap(([number, phase, items]) => items.map((text, i) => ({id:`${number}-${i}`,phase,number,text,done:false})));
  }

  function renderProgress() {
    const complete = state.tasks.filter(t => t.done).length;
    const p = percentage();
    $("side-project").textContent = state.project?.name || "No project yet";
    $("side-count").textContent = `${complete} / ${state.tasks.length} tasks shipped`;
    $("side-progress-bar").style.width = `${p}%`;
    $("progress-label").textContent = `${p}% complete`;
    $("progress-ring").style.setProperty("--progress",`${p}%`);
    $("progress-num").textContent = p;
  }
  function renderNext() {
    const host = $("next-action"); host.replaceChildren();
    const task = nextTask();
    if (!state.project) {
      host.append(el("div","empty-icon","↗"),el("h3","","Start with one idea."),el("p","","Your first concrete task will appear here when you forge a plan.")); return;
    }
    if (!task) {
      host.append(el("div","empty-icon","✦"),el("h3","","Prototype checklist complete."),el("p","","Playtest the game yourself, check the release gate, and keep improving only what matters."));
      const b = el("button","secondary-btn","Open playtest gate ↗"); b.addEventListener("click",()=>showView("playtest")); host.append(b); return;
    }
    host.append(el("div","task-kicker",task.phase),el("h3","",task.text),el("p","","Focus here until you can demonstrate the result. Then mark it done."));
    const b = el("button","secondary-btn","Copy build prompt ↗"); b.addEventListener("click",()=>copyText(makePrompt("builder"))); host.append(b);
  }
  function renderRoadmap() {
    const host = $("roadmap-body"); host.replaceChildren();
    if (!state.tasks.length) { host.append(el("p","empty-state","Your playable-first checklist will appear here. No giant roadmap, just the steps needed to get something working.")); return; }
    for (const phase of ["Core loop","AI proof","Game feel","Playable build"]) {
      const items = state.tasks.filter(t=>t.phase===phase);
      const section = el("section","phase"); section.append(el("div","phase-number",`PHASE ${items[0]?.number || ""}`),el("h3","",phase));
      for (const t of items) {
        const label = el("label",`task-row${t.done ? " done" : ""}`);
        const checkbox = document.createElement("input"); checkbox.type="checkbox"; checkbox.checked=t.done; checkbox.setAttribute("aria-label",t.text);
        checkbox.addEventListener("change",()=>{t.done=checkbox.checked;save();renderAll();});
        label.append(checkbox,el("span","",t.text)); section.append(label);
      }
      host.append(section);
    }
  }

  function makePrompt(agent) {
    if (!state.project) return "First create a project in the Workbench. Then return here to generate a context-specific prompt.";
    const p=state.project, task=nextTask();
    const common=`PROJECT: ${p.name}\nTYPE: ${p.genre}\nTARGET: ${p.platform}\nGAME IDEA: ${p.idea}\nFIRST INTELLIGENT FEATURE: ${p.ai}\nCURRENT NEXT TASK: ${task ? task.text : "Core task checklist complete; review and polish."}\n\nRules for every role:\n- Inspect the actual project files and engine version before changing anything.\n- Keep the smallest playable game working. Avoid speculative extras.\n- Do not invent completed work or claim tests that did not run.\n- Keep credentials out of game builds, prompts, logs, and Git.\n- Tell me what changed, what was verified, and what remains untested.`;
    const role = {
      builder:`You are my game implementation partner. Implement ONLY the current next task. Start with a concise change plan, inspect the current codebase, make the minimum compatible changes, then run appropriate checks. Preserve existing scenes and working behavior. If an AI service is needed, first create a deterministic local mock and a graceful offline fallback; do not put API secrets in the game. Return exact files changed, how to test the feature, and any limitations.`,
      designer:`You are my game systems designer. Analyze the idea and propose ONE fun, testable player loop with a concrete action, challenge, feedback, success state, and failure/retry state. Design the intelligent feature around two observable player inputs and two meaningful outcomes. Give acceptance criteria and explicitly park all ideas that are not necessary for the first prototype.`,
      reviewer:`You are a skeptical code and scope reviewer. Inspect the actual current implementation and assess correctness, game-state ownership, save/restart behavior, frame-time concerns, secret handling, and accidental scope growth. Identify concrete bugs with reproducible steps. Prioritize blockers, then minor improvements. Do not claim a defect without supporting evidence.`,
      tester:`You are my playtest lead. Produce a short executable manual test checklist for startup, controls, goal clarity, win, lose, retry, repeated restart, intelligent-system behavior, and network failure. Explain expected results and observable evidence. If you can run the build, report passes and failures; if you cannot, clearly mark everything untested.`
    }[agent];
    return `${role}\n\n${common}`;
  }
  function renderPrompt() {
    const descriptions={builder:"Build the next small working feature.",designer:"Make one mechanic fun and testable.",reviewer:"Find concrete bugs and scope creep.",tester:"Prove the game works, not just compiles."};
    $("prompt-description").textContent=descriptions[activeAgent];
    $("prompt-output").textContent=makePrompt(activeAgent);
    document.querySelectorAll(".agent-tab").forEach(b=>{const active=b.dataset.agent===activeAgent;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active));});
  }
  function renderChecks() {
    const host=$("checks");host.replaceChildren();
    let selected=0;
    for (const [id,title,desc] of checkItems) {
      const label=el("label","check-row");const input=document.createElement("input");input.type="checkbox";input.checked=!!state.checks[id];
      if(input.checked)selected++;
      input.addEventListener("change",()=>{state.checks[id]=input.checked;save();renderChecks();});
      const span=el("span");span.append(el("strong","",title),el("small","",desc));label.append(input,span);host.append(label);
    }
    $("test-score").textContent=`${selected} / ${checkItems.length} VERIFIED`;
  }
  function renderParking() {
    const host=$("parking-list");host.replaceChildren();
    if(!state.parking.length){host.append(el("li","empty-parking","All clear. Keep your game small enough to ship."));return;}
    state.parking.forEach((item,i)=>{const li=el("li");li.append(el("span","",item));const b=el("button","","×");b.type="button";b.setAttribute("aria-label",`Remove ${item}`);b.addEventListener("click",()=>{state.parking.splice(i,1);save();renderParking();});li.append(b);host.append(li);});
  }
  function renderAll() { renderProgress();renderNext();renderRoadmap();renderPrompt();renderChecks();renderParking(); }
  function showView(view) {
    document.querySelectorAll(".view").forEach(n=>n.classList.toggle("active",n.id===`view-${view}`));
    document.querySelectorAll(".nav-link").forEach(b=>{const a=b.dataset.view===view;b.classList.toggle("active",a);if(a)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
    $("page-name").textContent={workbench:"WORKBENCH",prompts:"PROMPT LAB",playtest:"PLAYTEST",journal:"JOURNAL"}[view];
    window.scrollTo({top:0,behavior:"smooth"});
  }
  async function copyText(value) {
    try {await navigator.clipboard.writeText(value);notify("Copied. Paste it into your AI coding assistant.");}
    catch {
      const textArea=document.createElement("textarea");textArea.value=value;textArea.style.position="fixed";textArea.style.opacity="0";document.body.append(textArea);textArea.select();
      let ok=false;try{ok=document.execCommand("copy");}catch{}textArea.remove();notify(ok?"Copied. Paste it into your coding assistant.":"Clipboard blocked. Select and copy the prompt from Prompt Lab.");
    }
  }
  function fillForm() {
    if(!state.project)return;const p=state.project;
    $("game-name").value=p.name;$("game-idea").value=p.idea;
    $("game-genre").value=p.genre;$("game-platform").value=p.platform;$("game-ai").value=p.ai;
  }
  function exportState() {
    const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${(state.project?.name || "game-forge").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "game-forge"}-backup.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);notify("Backup downloaded.");
  }

  document.querySelectorAll(".nav-link").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll(".agent-tab").forEach(b=>b.addEventListener("click",()=>{activeAgent=b.dataset.agent;renderPrompt();}));
  $("project-form").addEventListener("submit",event=>{
    event.preventDefault();
    const project={name:$("game-name").value.trim(),idea:$("game-idea").value.trim(),genre:$("game-genre").value,platform:$("game-platform").value,ai:$("game-ai").value};
    if(!project.name || !project.idea){notify("Add a name and a game idea first.");return;}
    if(state.tasks.length && !confirm("Replace the existing roadmap and task progress? Your notes and parking lot will stay. Export first if you want a backup."))return;
    state.project=project;state.tasks=createPlan(project);state.checks={};save();renderAll();notify("Your first playable roadmap is ready.");$("roadmap-title").scrollIntoView({behavior:"smooth",block:"center"});
  });
  $("copy-prompt").addEventListener("click",()=>copyText(makePrompt(activeAgent)));
  $("journal-notes").addEventListener("input",event=>{state.journal=event.target.value;save();});
  $("parking-form").addEventListener("submit",event=>{event.preventDefault();const v=$("parking-input").value.trim();if(!v)return;state.parking.push(v);$("parking-input").value="";save();renderParking();});
  $("export-btn").addEventListener("click",exportState);
  $("import-file").addEventListener("change",async event=>{
    const file=event.target.files?.[0];event.target.value="";if(!file)return;
    if(file.size>2_000_000){notify("Backup is too large (2 MB maximum).");return;}
    try{const parsed=JSON.parse(await file.text());if(!parsed || typeof parsed!=="object" || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.parking)){throw new Error("Invalid format");}
      if(!confirm("Replace this browser's workspace with the imported backup?"))return;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(parsed));state=loadState();fillForm();$("journal-notes").value=state.journal;renderAll();notify("Backup imported successfully.");
    }catch{notify("Could not import that backup file.");}
  });
  $("reset-btn").addEventListener("click",()=>{
    if(!confirm("Clear this browser's Game Forge workspace? Export first if you want to keep it."))return;
    state=emptyState();save();$("project-form").reset();$("journal-notes").value="";renderAll();showView("workbench");notify("Workspace cleared.");
  });

  fillForm();$("journal-notes").value=state.journal;renderAll();
})();
