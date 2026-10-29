// Local QA only: simulated identities and in-memory R2, never included in the hosted bundle.
import http from "node:http";
import { createHash } from "node:crypto";
import worker from "../dist/server/index.js";
class LocalBucket {
  records=new Map();
  async get(key){const r=this.records.get(key);return r?{etag:r.etag,text:async()=>r.body}:null;}
  async put(key,body,{onlyIf}){
    const r=this.records.get(key);
    if(onlyIf.get("if-none-match")==="*" && r)return null;
    const match=onlyIf.get("if-match");if(match && match!=='"'+r?.etag+'"')return null;
    const saved={body,etag:createHash("md5").update(body).digest("hex")};
    this.records.set(key,saved);return saved;
  }
}
const env={BUCKET:new LocalBucket()};
http.createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const c of req)chunks.push(c);
    const headers=new Headers(req.headers);
    // The local adapter represents Sites dispatch. Production never uses this adapter.
    headers.delete("oai-authenticated-user-id");headers.set("oai-authenticated-user-id",req.headers.host==="localhost:4318"?"local-qa-two":"local-qa-one");
    const request=new Request((req.headers.host==="localhost:4318"?"http://localhost:4318":"http://127.0.0.1:4318")+req.url,{method:req.method,headers,
      ...(["GET","HEAD"].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const result=await worker.fetch(request,env);
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  } catch {res.writeHead(500,{"content-type":"text/plain"});res.end("Local preview error");}
}).listen(4318,"127.0.0.1",()=>console.log("Local QA (simulated identity + memory storage): http://127.0.0.1:4318"));
