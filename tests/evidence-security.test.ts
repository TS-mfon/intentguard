import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {performance} from "node:perf_hooks";
import {createEvidenceFetcher} from "../apps/web/lib/evidence";
function transport(headers:Record<string,string>={},behavior="complete"){
 let destroyed=false,ended=false,callback:((res:any)=>void)|undefined,request:any;
 const res=new EventEmitter() as any;res.statusCode=200;res.headers={"content-type":"application/json",...headers};
 const adapter={lookup:async()=>[{address:"1.1.1.1",family:4}],request:(_url:any,options:any,handler:any)=>{
  assert.equal(options.headers["Accept-Encoding"],"identity");callback=handler;request=new EventEmitter() as any;
  request.destroy=(error:Error)=>{destroyed=true;queueMicrotask(()=>request.emit("error",error));};
  request.end=()=>{ended=true;queueMicrotask(()=>{callback!(res);if(behavior==="complete"){res.emit("data",Buffer.from('{"ok":true}'));res.emit("end");}});};return request;
 }};
 return {adapter:adapter as any,res,get destroyed(){return destroyed},get ended(){return ended}};
}
test("S04 byte trickle cannot extend the absolute evidence deadline",async()=>{
 const t=transport({},"trickle"),fetcher=createEvidenceFetcher(t.adapter,40),started=performance.now(),timer=setInterval(()=>t.res.emit("data",Buffer.from(" ")),5);
 try{await assert.rejects(fetcher("https://merchant.example/invoice"),/timed out/);assert.ok(performance.now()-started<500);assert.equal(t.destroyed,true);}finally{clearInterval(timer);}
});
test("absolute deadline also bounds DNS and never connects after late resolution",async()=>{
 const t=transport(),original=t.adapter.lookup;t.adapter.lookup=async()=>{await new Promise(resolve=>setTimeout(resolve,80));return original();};
 await assert.rejects(createEvidenceFetcher(t.adapter,20)("https://merchant.example"),/timed out/);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(t.ended,false);
});
test("public complete UTF-8 evidence succeeds within the absolute deadline",async()=>{const t=transport();assert.equal(await createEvidenceFetcher(t.adapter,500)("https://merchant.example"),'{"ok":true}');assert.equal(t.destroyed,false);});
test("compression, declared excess size, redirects, invalid UTF-8 and abrupt close are rejected",async()=>{
 for(const headers of [{"content-encoding":"gzip"},{"content-length":"65537"},{"content-length":"x"}] as Record<string,string>[]){const t=transport(headers);await assert.rejects(createEvidenceFetcher(t.adapter,500)("https://merchant.example"));assert.equal(t.destroyed,true);}
 for(const behavior of ["redirect","invalid-utf8","aborted"]){const t=transport({},"manual"),promise=createEvidenceFetcher(t.adapter,500)("https://merchant.example");const rejected=assert.rejects(promise);if(behavior==="redirect")t.res.statusCode=302;await new Promise(resolve=>setTimeout(resolve,1));if(behavior==="invalid-utf8"){t.res.emit("data",Buffer.from([0xff]));t.res.emit("end");}if(behavior==="aborted")t.res.emit("aborted");await rejected;}
});
test("mixed public and private DNS answers fail before transport",async()=>{const t=transport();t.adapter.lookup=async()=>[{address:"1.1.1.1",family:4},{address:"127.0.0.1",family:4}];await assert.rejects(createEvidenceFetcher(t.adapter,500)("https://merchant.example"),/private/);assert.equal(t.ended,false);});
