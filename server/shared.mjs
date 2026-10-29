// Deploy only through the Sites private dispatch, never as a standalone public Worker.
// Dispatch authenticates visitors, strips/replaces identity headers, and enforces its allowlist.
import { validState, blank } from "../state.mjs";
export { validState } from "../state.mjs";
const RECORD = "ascend/shared-state-v1.json";
const MAX_BYTES = 150_000;
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
  if (!request.headers.get("oai-authenticated-user-id")?.trim()) return reply({error:"Sign-in required"},401);
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
  if (request.method === "GET") {
    try {
      const record = await env.BUCKET.get(RECORD);
      if (!record) return reply({etag:null,state:blank()});
      const state = JSON.parse(await record.text());
      return validState(state) ? reply({etag:record.etag,state}) : reply({error:"Stored data needs recovery"},503);
    } catch { return reply({error:"Shared storage read failed"},503); }
  }
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_BYTES) return reply({error:"Payload too large"},413);
  let data;
  try {
    const body = await limitedBody(request);
    if (body === null) return reply({error:"Payload too large"},413);
    data = JSON.parse(body);
    if (!data || Object.keys(data).length !== 2 || !Object.hasOwn(data,"etag") ||
        (data.etag !== null && (typeof data.etag !== "string" || !/^[a-f0-9]{32}$/.test(data.etag))) ||
        !validState(data.state)) return reply({error:"Invalid shared state"},400);
  } catch { return reply({error:"Malformed JSON"},400); }
  try {
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
