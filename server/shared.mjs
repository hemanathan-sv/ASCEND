// ASCEND private shared-state API, hosted behind the Sites two-person allowlist.
// R2 stores one JSON document with atomic conditional updates.
const RECORD = "ascend/shared-state-v1.json";
const EMPTY = { days: {}, bosses: {}, wellness: {}, vault: [] };
const MAX_BYTES = 150_000;
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
});

export function validState(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  for (const key of ["days", "bosses", "wellness"]) if (!s[key] || typeof s[key] !== "object" || Array.isArray(s[key])) return false;
  if (!Array.isArray(s.vault) || s.vault.length > 100 || s.vault.some(v => typeof v !== "string" || v.length > 140)) return false;
  if (Object.keys(s.days).length > 500 || Object.keys(s.bosses).length > 100 || Object.keys(s.wellness).length > 500) return false;
  for (const [date, quests] of Object.entries(s.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(quests) || quests.length > 3) return false;
    if (quests.some(q => !q || typeof q.id !== "string" || q.id.length > 80 || typeof q.title !== "string" || q.title.length > 120 || !["mind", "build", "body"].includes(q.lane) || typeof q.done !== "boolean")) return false;
  }
  for (const [week, boss] of Object.entries(s.bosses)) {
    if (!/^\d{4}-W\d{2}$/.test(week) || !boss || typeof boss.title !== "string" || boss.title.length > 160 || typeof boss.done !== "boolean") return false;
  }
  for (const [date, entry] of Object.entries(s.wellness)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (!["", "rough", "low", "okay", "good", "great"].includes(entry.mood)) return false;
    if (entry.sleep !== null && (typeof entry.sleep !== "number" || !Number.isFinite(entry.sleep) || entry.sleep < 0 || entry.sleep > 24)) return false;
    if (!["", "low", "okay", "high"].includes(entry.energy) || typeof entry.note !== "string" || entry.note.length > 180) return false;
  }
  return true;
}

export async function handleShared(request, env) {
  // The host's private access policy is the authority for which two users may enter.
  if (!request.headers.get("oai-authenticated-user-id")) return reply({ error: "Sign-in required" }, 401);
  if (!env?.BUCKET || typeof env.BUCKET.get !== "function") return reply({ error: "Shared storage unavailable" }, 503);
  if (request.method === "GET") {
    const record = await env.BUCKET.get(RECORD);
    if (!record) return reply({ etag: null, state: EMPTY });
    try {
      const state = JSON.parse(await record.text());
      return validState(state) ? reply({ etag: record.etag, state }) : reply({ error: "Stored data needs recovery" }, 503);
    } catch { return reply({ error: "Stored data needs recovery" }, 503); }
  }
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, PUT" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Cross-origin write rejected" }, 403);
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_BYTES) return reply({ error: "Payload too large" }, 413);
  let data, body;
  try {
    body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BYTES) return reply({ error: "Payload too large" }, 413);
    data = JSON.parse(body);
    if (!data || !Object.hasOwn(data, "etag") ||
        (data.etag !== null && (typeof data.etag !== "string" || !/^[a-f0-9]{32}$/.test(data.etag))) ||
        !validState(data.state)) return reply({ error: "Invalid shared state" }, 400);
  } catch { return reply({ error: "Malformed JSON" }, 400); }
  try {
    const conditions = new Headers(data.etag === null ? { "if-none-match": "*" } : { "if-match": `"${data.etag}"` });
    const saved = await env.BUCKET.put(RECORD, JSON.stringify(data.state), {
      onlyIf: conditions, httpMetadata: { contentType: "application/json" }
    });
    return saved ? reply({ etag: saved.etag }) : reply({ error: "Sync conflict. Reload before saving." }, 409);
  } catch (error) {
    if (String(error).includes("PreconditionFailed") || String(error).includes("412"))
      return reply({ error: "Sync conflict. Reload before saving." }, 409);
    return reply({ error: "Storage write failed" }, 503);
  }
}
