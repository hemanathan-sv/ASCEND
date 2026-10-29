import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleShared, validState } from "./shared.mjs";

const sample = () => ({
  days: { "2026-10-29": [{ id: "one", title: "Ship a mechanic", lane: "build", done: true }] },
  bosses: {},
  wellness: { "2026-10-29": { mood: "okay", sleep: 8, energy: "high", note: "Rest" } },
  vault: ["Another game idea"]
});

class Bucket {
  record = null;
  async get() {
    if (!this.record) return null;
    const { etag, body } = this.record;
    return { etag, text: async () => body };
  }
  async put(_key, body, options) {
    const expect = options.onlyIf;
    const match = expect.get("if-match");
    const none = expect.get("if-none-match");
    if (none === "*" && this.record) return null;
    if (match && (!this.record || match !== '"' + this.record.etag + '"')) return null;
    const etag = createHash("md5").update(body).digest("hex");
    this.record = { body, etag };
    return { etag };
  }
}

const url = "https://ascend.example/api/shared";
const req = (method, payload, signed = true, origin = true) => {
  const headers = { ...(signed ? { "oai-authenticated-user-id": "test-account" } : {}),
    ...(origin ? { origin: "https://ascend.example" } : {}),
    "content-type": "application/json" };
  return new Request(url, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
};

test("rejects anonymous visits and foreign-origin writes", async () => {
  const env = { BUCKET: new Bucket() };
  assert.equal((await handleShared(req("GET", null, false), env)).status, 401);
  assert.equal((await handleShared(req("PUT", { etag: null, state: sample() }, true, false), env)).status, 403);
});
test("protects schema, including shared wellness data", async () => {
  const invalid = sample();
  invalid.wellness["2026-10-29"].sleep = -50;
  assert.equal(validState(invalid), false);
  assert.equal((await handleShared(req("PUT", { etag: null, state: invalid }), { BUCKET: new Bucket() })).status, 400);
});
test("reads, saves, and detects competing browser writes", async () => {
  const env = { BUCKET: new Bucket() };
  let response = await handleShared(req("GET"), env);
  assert.deepEqual(await response.json(), { etag: null, state: { days: {}, bosses: {}, wellness: {}, vault: [] } });
  response = await handleShared(req("PUT", { etag: null, state: sample() }), env);
  assert.equal(response.status, 200);
  const { etag } = await response.json();
  assert.match(etag, /^[a-f0-9]{32}$/);
  assert.equal((await handleShared(req("PUT", { etag: null, state: sample() }), env)).status, 409);
  const updated = sample();updated.days["2026-10-29"][0].done = false;
  response = await handleShared(req("PUT", { etag, state: updated }), env);
  assert.equal(response.status, 200);
  response = await handleShared(req("GET"), env);
  assert.equal((await response.json()).state.days["2026-10-29"][0].done, false);
});
