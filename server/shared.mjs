// Deploy only through the Sites private dispatch, never as a standalone public Worker.
// Dispatch authenticates visitors, strips/replaces identity headers, and enforces its allowlist.
import { validState, blank, migrateState, validAuthor } from "../state.mjs";
export { validState } from "../state.mjs";
const RECORD = "ascend/shared-state-v1.json";
const MAX_BYTES = 150_000;
const AUTHORS = "ascend/authenticated-authors-v1.json";
async function registeredAuthors(bucket,userId) {
  for(let attempt=0;attempt<3;attempt++){
    const record=await bucket.get(AUTHORS),ids=record?JSON.parse(await record.text()):[];
    if(!Array.isArray(ids) || ids.length>2 || !ids.every(validAuthor) || new Set(ids).size!==ids.length)throw new Error("Invalid identity registry");
    if(ids.includes(userId))return ids;
    if(ids.length===2)return null;
    const next=[...ids,userId];
    const saved=await bucket.put(AUTHORS,JSON.stringify(next),{onlyIf:new Headers(record?{"if-match":'"'+record.etag+'"'}:{"if-none-match":"*"}),httpMetadata:{contentType:"application/json"}});
    if(saved)return next;
  }
  throw new Error("Identity registration conflict");
}
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"private, no-store",
    "x-content-type-options":"nosniff", "vary":"Cookie, OAI-Authenticated-User-Id" }
});
async function limitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal:true }).decode(bytes);
}
export async function handleShared(request, env) {
  const userId=request.headers.get("oai-authenticated-user-id");
  if(!validAuthor(userId))return reply({error:"Sign-in required"},401);
  if (request.method !== "GET" && request.method !== "PUT")
    return new Response(null,{status:405,headers:{allow:"GET, PUT","cache-control":"no-store"}});
  if (request.method === "PUT") {
    if (request.headers.get("origin") !== new URL(request.url).origin ||
        ["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")))
      return reply({error:"Cross-origin write rejected"},403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
      return reply({error:"JSON required"},415);
  }
  if (!env?.BUCKET || typeof env.BUCKET.get !== "function" || typeof env.BUCKET.put !== "function")
    return reply({error:"Shared storage unavailable"},503);
  let authors;
  try{authors=await registeredAuthors(env.BUCKET,userId);}catch{return reply({error:"Identity storage unavailable"},503);}
  if(!authors)return reply({error:"Only the two registered visitors may access this profile"},403);
  if (request.method === "GET") {
    try {
      const record = await env.BUCKET.get(RECORD);
      if (!record) return reply({etag:null,state:blank(),userId,schemaVersion:3});
      const state = migrateState(JSON.parse(await record.text()));
      return reply({etag:record.etag,state,userId,schemaVersion:3});
    } catch { return reply({error:"Shared storage read failed"},503); }
  }
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_BYTES) return reply({error:"Payload too large"},413);
  let data;
  try {
    const body = await limitedBody(request);
    if (body === null) return reply({error:"Payload too large"},413);
    data = JSON.parse(body);
    if (!data || Object.keys(data).some(k=>!["etag","state","operation","confirmation"].includes(k)) || !Object.hasOwn(data,"etag") ||
        (data.etag !== null && (typeof data.etag !== "string" || !/^[a-f0-9]{32}$/.test(data.etag))) ||
        !validState(data.state)) return reply({error:"Invalid shared state"},400);
  } catch { return reply({error:"Malformed JSON"},400); }
  try {
    const record=await env.BUCKET.get(RECORD);
    if((record?.etag ?? null)!==data.etag)return reply({error:"Sync conflict. Load latest before saving."},409);
    const raw=record?await record.text():null;
    const current=raw?migrateState(JSON.parse(raw)):blank();
    const operation=data.operation || "update";
    if(operation==="reset"){
      if(data.confirmation!=="RESET SHARED PROFILE" || JSON.stringify(data.state)!==JSON.stringify(blank()))
        return reply({error:"Explicit reset confirmation required"},400);
    } else if(operation==="restore"){
      if(data.confirmation!=="REPLACE SHARED PROFILE")return reply({error:"Explicit restore confirmation required"},400);
      if(Object.values(data.state.wellness).flat().some(e=>e.authorId!==null && !authors.includes(e.authorId)))
        return reply({error:"Backup contains an author who has not authenticated to this profile"},400);
    } else if(operation==="update"){
      // Other people's and unattributed legacy entries are read-only during normal edits.
      const foreign=s=>JSON.stringify(Object.entries(s.wellness).map(([date,entries])=>[date,entries.filter(e=>e.authorId!==userId).sort((a,b)=>String(a.authorId).localeCompare(String(b.authorId)))]).filter(([,v])=>v.length).sort(([a],[b])=>a.localeCompare(b)));
      if(foreign(current)!==foreign(data.state))return reply({error:"You may update only your own wellness check-in"},403);
    } else return reply({error:"Unknown update operation"},400);
    // Preserve the exact prior document before changing it, including pre-migration data.
    if(raw)await env.BUCKET.put("ascend/recovery/"+record.etag+".json",raw,{
      onlyIf:new Headers({"if-none-match":"*"}),httpMetadata:{contentType:"application/json"}
    });
    const saved = await env.BUCKET.put(RECORD,JSON.stringify(data.state),{
      onlyIf:new Headers(data.etag === null ? {"if-none-match":"*"} : {"if-match":'"'+data.etag+'"'}),
      httpMetadata:{contentType:"application/json"}
    });
    return saved ? reply({etag:saved.etag}) : reply({error:"Sync conflict. Load latest before saving."},409);
  } catch (error) {
    if (String(error).includes("PreconditionFailed") || String(error).includes("412"))
      return reply({error:"Sync conflict. Load latest before saving."},409);
    return reply({error:"Storage write failed"},503);
  }
}
