import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleShared, validState } from "./shared.mjs";
test("a backup cannot invent authenticated authors and a third identity is rejected",async()=>{
  const env={BUCKET:new Bucket()},state=sample();
  state.wellness["2026-10-29"][0].authorId="invented-author";
  assert.equal((await handleShared(req("PUT",{etag:null,state,operation:"restore",confirmation:"REPLACE SHARED PROFILE"}),env)).status,400);
  const second=req("GET");second.headers.set("oai-authenticated-user-id","second-test-account");
  assert.equal((await handleShared(second,env)).status,200);
  const third=req("GET");third.headers.set("oai-authenticated-user-id","third-test-account");
  assert.equal((await handleShared(third,env)).status,403);
});
test("two authenticated authors keep separate same-day wellness entries and cannot edit each other",async()=>{
  const env={BUCKET:new Bucket()};
  const first=sample();
  let res=await handleShared(req("PUT",{etag:null,state:first}),env);
  let {etag}=await res.json();
  const second=structuredClone(first);second.wellness["2026-10-29"].push({authorId:"second-test-account",mood:"low",sleep:null,energy:"low",note:"Second person's note"});
  const bySecond=req("PUT",{etag,state:second});bySecond.headers.set("oai-authenticated-user-id","second-test-account");
  res=await handleShared(bySecond,env);assert.equal(res.status,200);({etag}=await res.json());
  const read=await (await handleShared(req("GET"),env)).json();
  assert.equal(read.userId,"test-account");assert.equal(read.state.wellness["2026-10-29"].length,2);
  const tampered=structuredClone(second);tampered.wellness["2026-10-29"][1].note="Forged by first person";
  assert.equal((await handleShared(req("PUT",{etag,state:tampered}),env)).status,403);
  const legitimate=structuredClone(second);legitimate.wellness["2026-10-29"][0].note="My updated entry";
  assert.equal((await handleShared(req("PUT",{etag,state:legitimate}),env)).status,200);
  const final=await (await handleShared(req("GET"),env)).json();
  assert.equal(final.state.wellness["2026-10-29"][1].note,"Second person's note");
  const duplicate=structuredClone(final.state);duplicate.wellness["2026-10-29"].push({...duplicate.wellness["2026-10-29"][0]});
  assert.equal(validState(duplicate),false);
});
test("migrates legacy wellness without inventing authors and saves an exact recovery copy",async()=>{
  const env={BUCKET:new Bucket()},old=sample();old.wellness["2026-10-29"]=old.wellness["2026-10-29"][0];delete old.wellness["2026-10-29"].authorId;
  const raw=JSON.stringify(old),etag="a".repeat(32);env.BUCKET.record={body:raw,etag};
  const loaded=await (await handleShared(req("GET"),env)).json();
  assert.equal(loaded.state.wellness["2026-10-29"][0].authorId,null);
  assert.equal(env.BUCKET.record.body,raw,"GET migration is read-only");
  loaded.state.wellness["2026-10-29"].push({authorId:"test-account",mood:"good",sleep:7,energy:"okay",note:"My own entry"});
  assert.equal((await handleShared(req("PUT",{etag,state:loaded.state}),env)).status,200);
  assert.equal(env.BUCKET.records.get("ascend/recovery/"+etag+".json").body,raw);
  const state=loaded.state;state.wellness["2026-10-29"][0].authorId="test-account";
  assert.equal(validState(state),false,"legacy entry cannot be claimed by the current author");
});
test("old tabs fail closed and reset/restore require explicit shared replacement intent",async()=>{
  const env={BUCKET:new Bucket()};let res=await handleShared(req("PUT",{etag:null,state:sample()}),env);
  const {etag}=await res.json(),empty={days:{},bosses:{},wellness:{},vault:[]};
  const other=req("PUT",{etag,state:empty});other.headers.set("oai-authenticated-user-id","second-test-account");
  assert.equal((await handleShared(other,env)).status,403);
  assert.equal((await handleShared(req("PUT",{etag,state:empty,operation:"reset"}),env)).status,400);
  assert.equal((await handleShared(req("PUT",{etag,state:empty,operation:"reset",confirmation:"RESET SHARED PROFILE"}),env)).status,200);
  const latest=await (await handleShared(req("GET"),env)).json();
  assert.equal((await handleShared(req("PUT",{etag:latest.etag,state:sample(),operation:"restore",confirmation:"REPLACE SHARED PROFILE"}),env)).status,200);
});
test("failed recovery backup prevents any modification to the current profile",async()=>{
  const bucket=new Bucket();await handleShared(req("PUT",{etag:null,state:sample()}),{BUCKET:bucket});
  const initial=bucket.record;
  const env={BUCKET:{get:key=>bucket.get(key),put:async()=>{throw new Error("backup unavailable");}}};
  const next=sample();next.vault=[];
  assert.equal((await handleShared(req("PUT",{etag:initial.etag,state:next}),env)).status,503);
  assert.deepEqual(bucket.record,initial);
});

const sample = () => ({
  days: { "2026-10-29": [{ id: "one", title: "Ship a mechanic", lane: "build", done: true }] },
  bosses: {},
  wellness: { "2026-10-29": [{ authorId:"test-account", mood: "okay", sleep: 8, energy: "high", note: "Rest" }] },
  vault: ["Another game idea"]
});
test("validates exact fields, real dates, IDs, ISO weeks and backup limits", () => {
  for (const mutate of [
    s => s.extra="private", s => s.days["2026-02-30"]=[],
    s => s.days["2026-10-29"][0].title=" ", s => s.days["2026-10-29"][0].lane="__proto__",
    s => s.days["2026-10-29"].push({...s.days["2026-10-29"][0]}),
    s => s.bosses["2026-W54"]={title:"bad",done:false},
    s => s.wellness["2026-10-29"][0].extra="hidden",
    s => s.days["2026-10-29"][0].done="true",
    s => s.vault=Array(101).fill("idea")
  ]) { const s=sample();mutate(s);assert.equal(validState(s),false); }
  const s=sample();s.bosses["2026-W53"]={title:"Valid ISO week",done:false};assert.equal(validState(s),true);
});
test("separates two authenticated sessions into one shared profile", async () => {
  const env={BUCKET:new Bucket()};
  await handleShared(req("PUT",{etag:null,state:sample()}),env);
  const second=new Request(url,{headers:{"oai-authenticated-user-id":"second-test-account"}});
  assert.deepEqual((await (await handleShared(second,env)).json()).state,sample());
});
test("rejects foreign origins, same-site subdomains, non-JSON and unsupported methods", async () => {
  const env={BUCKET:new Bucket()};
  for(const headers of [
    {origin:"https://evil.example"}, {origin:"null"}, {"sec-fetch-site":"same-site"}, {"sec-fetch-site":"cross-site"}
  ]) {
    const r=req("PUT",{etag:null,state:sample()});for(const [k,v] of Object.entries(headers))r.headers.set(k,v);
    assert.equal((await handleShared(r,env)).status,403);
  }
  const r=req("PUT",{etag:null,state:sample()});r.headers.set("content-type","text/plain");
  assert.equal((await handleShared(r,env)).status,415);
  assert.equal((await handleShared(req("POST"),env)).status,405);
  assert.equal((await handleShared(req("OPTIONS"),env)).status,405);
});
test("bounds bytes with and without Content-Length, including streamed bodies", async () => {
  const env={BUCKET:new Bucket()};
  const headers={"oai-authenticated-user-id":"test",origin:"https://ascend.example","content-type":"application/json"};
  const body="é".repeat(80000);
  assert.equal((await handleShared(new Request(url,{method:"PUT",headers,body}),env)).status,413);
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(150001));c.close();}});
  assert.equal((await handleShared(new Request(url,{method:"PUT",headers,body:stream,duplex:"half"}),env)).status,413);
  assert.equal(env.BUCKET.record,null);
});
test("returns safe errors for corrupt storage, read/write failures, and invalid JSON", async () => {
  let env={BUCKET:new Bucket()};env.BUCKET.record={body:"{}",etag:"a".repeat(32)};
  assert.equal((await handleShared(req("GET"),env)).status,503);
  env={BUCKET:{get:async()=>{throw new Error("private details");},put:async()=>{throw new Error("private details");}}};
  const r=await handleShared(req("GET"),env);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private details/);
  assert.equal((await handleShared(req("PUT",{etag:null,state:sample()}),env)).status,503);
  const bad=req("PUT",{etag:null,state:sample()});const headers=bad.headers;
  assert.equal((await handleShared(new Request(url,{method:"PUT",headers,body:"{"}),{BUCKET:new Bucket()})).status,400);
});
test("simultaneous conditional writes accept exactly one winner", async () => {
  const env={BUCKET:new Bucket()};
  const a=sample(),b=sample();b.vault=["Second browser"];
  const results=await Promise.all([handleShared(req("PUT",{etag:null,state:a}),env),handleShared(req("PUT",{etag:null,state:b}),env)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const result=await handleShared(req("GET"),env);
  assert.equal(result.headers.get("cache-control"),"private, no-store");
  assert.deepEqual((await result.json()).state,a);
});

class Bucket {
  records=new Map();
  get record(){return this.records.get("ascend/shared-state-v1.json") || null;}
  set record(v){this.records.set("ascend/shared-state-v1.json",v);}
  async get(key="ascend/shared-state-v1.json"){
    const r=this.records.get(key);return r?{etag:r.etag,text:async()=>r.body}:null;
  }
  async put(key,body,{onlyIf}){
    const r=this.records.get(key),match=onlyIf.get("if-match"),none=onlyIf.get("if-none-match");
    if(none==="*" && r)return null;
    if(match && match!=='"'+r?.etag+'"')return null;
    const etag=createHash("md5").update(body).digest("hex");
    this.records.set(key,{body,etag});return {etag};
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
  invalid.wellness["2026-10-29"][0].sleep = -50;
  assert.equal(validState(invalid), false);
  assert.equal((await handleShared(req("PUT", { etag: null, state: invalid }), { BUCKET: new Bucket() })).status, 400);
});
test("reads, saves, and detects competing browser writes", async () => {
  const env = { BUCKET: new Bucket() };
  let response = await handleShared(req("GET"), env);
  assert.deepEqual(await response.json(), { etag: null, state: { days: {}, bosses: {}, wellness: {}, vault: [] }, userId:"test-account", schemaVersion:3 });
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
