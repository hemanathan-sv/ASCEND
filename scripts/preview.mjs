// Local QA only: simulated identities and in-memory R2, never included in the hosted bundle.
import http from "node:http";
import { createHash } from "node:crypto";
import worker from "../dist/server/index.js";
class LocalBucket {
  record=null;
  async get(){const record=this.record;return record?{etag:record.etag,text:async()=>record.body}:null;}
  async put(_key,body,{onlyIf}){
    if(onlyIf.get("if-none-match")==="*" && this.record)return null;
    const match=onlyIf.get("if-match");
    if(match && match!=='"'+this.record?.etag+'"')return null;
    this.record={body,etag:createHash("md5").update(body).digest("hex")};return this.record;
  }
}
const env={BUCKET:new LocalBucket()};
http.createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const c of req)chunks.push(c);
    const headers=new Headers(req.headers);
    // The local adapter represents Sites dispatch. Production never uses this adapter.
    headers.delete("oai-authenticated-user-id");headers.set("oai-authenticated-user-id","local-qa-visitor");
    const request=new Request("http://127.0.0.1:4318"+req.url,{method:req.method,headers,
      ...(["GET","HEAD"].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const result=await worker.fetch(request,env);
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  } catch {res.writeHead(500,{"content-type":"text/plain"});res.end("Local preview error");}
}).listen(4318,"127.0.0.1",()=>console.log("Local QA (simulated identity + memory storage): http://127.0.0.1:4318"));
