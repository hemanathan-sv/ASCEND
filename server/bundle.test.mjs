import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";

const url = "https://ascend.example/";
const authed = { "oai-authenticated-user-id": "test-account" };

test("private bundle blocks anonymous visitors, even for JavaScript", async () => {
  assert.equal((await worker.fetch(new Request(url), {})).status, 401);
  assert.equal((await worker.fetch(new Request(url + "app.js"), {})).status, 401);
});
test("private bundle serves the existing ASCEND interface to authorized visitors", async () => {
  const page = await worker.fetch(new Request(url, { headers: authed }), {});
  assert.equal(page.status, 200);
  assert.match(await page.text(), /ASCEND/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const js = await worker.fetch(new Request(url + "app.js", { headers: authed }), {});
  assert.equal(js.status, 200);
  assert.match(await js.text(), /SHARED_API/);
});
test("private bundle rejects missing storage bindings for signed-in API calls", async () => {
  const api = await worker.fetch(new Request(url + "api/shared", { headers: authed }), {});
  assert.equal(api.status, 503);
});
