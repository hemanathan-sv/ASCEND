// Shared by the browser, backup importer, and Worker. No record contents are logged.
export const blank = () => ({ days: {}, bosses: {}, wellness: {}, vault: [] });
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const dateKey = v => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const weekKey = v => {
  if (!/^\d{4}-W\d{2}$/.test(v)) return false;
  const year = Number(v.slice(0,4)), week = Number(v.slice(6));
  const day = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return week >= 1 && week <= (day === 4 || (day === 3 && leap) ? 53 : 52);
};
export function validState(s) {
  if (!keys(s, ["days", "bosses", "wellness", "vault"])) return false;
  for (const k of ["days", "bosses", "wellness"]) if (!object(s[k])) return false;
  if (Object.keys(s.days).length > 500 || Object.keys(s.bosses).length > 100 || Object.keys(s.wellness).length > 500) return false;
  if (!Array.isArray(s.vault) || s.vault.length > 100 || s.vault.some(v => !text(v,140))) return false;
  for (const [date, quests] of Object.entries(s.days)) {
    if (!dateKey(date) || !Array.isArray(quests) || quests.length > 3) return false;
    const ids = new Set();
    for (const q of quests) {
      if (!keys(q, ["id","title","lane","done"]) || !text(q.id,80) || ids.has(q.id) ||
          !text(q.title,120) || !["mind","build","body"].includes(q.lane) || typeof q.done !== "boolean") return false;
      ids.add(q.id);
    }
  }
  for (const [week, b] of Object.entries(s.bosses))
    if (!weekKey(week) || !keys(b, ["title","done"]) || !text(b.title,160) || typeof b.done !== "boolean") return false;
  const authors=new Set();
  for (const [date, records] of Object.entries(s.wellness)) {
    if(!dateKey(date) || !Array.isArray(records) || records.length>3 || records.length===0)return false;
    const seen=new Set();
    for(const e of records){
      if(!keys(e,["authorId","mood","sleep","energy","note"]) ||
          !(e.authorId===null || validAuthor(e.authorId)) || seen.has(e.authorId) ||
          !["","rough","low","okay","good","great"].includes(e.mood) ||
          !(e.sleep===null || (typeof e.sleep==="number" && Number.isFinite(e.sleep) && e.sleep>=0 && e.sleep<=24)) ||
          !["","low","okay","high"].includes(e.energy) || typeof e.note!=="string" || e.note.length>180)return false;
      seen.add(e.authorId);if(e.authorId!==null)authors.add(e.authorId);
    }
  }
  if(authors.size>2)return false;
  return true;
}
export const validAuthor = id => typeof id==="string" && /^[A-Za-z0-9:_-]{1,160}$/.test(id);
export function migrateState(raw) {
  if(!object(raw) || !object(raw.wellness))throw new Error("Invalid shared state");
  const wellness={};
  for(const [date,entry] of Object.entries(raw.wellness)){
    // Existing records have no reliable author. Preserve them without assigning one.
    wellness[date]=Array.isArray(entry)?entry:[{...entry,authorId:null}];
  }
  const candidate={...raw,wellness};
  if(!validState(candidate))throw new Error("Invalid shared state");
  return candidate;
}
export function fromBackup(raw) {
  if (!object(raw) || Object.keys(raw).some(k => !["days","bosses","wellness","vault","version","exportedAt"].includes(k)) ||
      (raw.version !== undefined && ![1,2,3].includes(raw.version))) throw new Error("Invalid backup format");
  const candidate = { days:raw.days, bosses:raw.bosses, wellness:raw.wellness ?? {}, vault:raw.vault };
  return migrateState(candidate);
}
