import test from "node:test";
import assert from "node:assert/strict";
import {runWorker,workerDuration,WorkerConnectivityError} from "../apps/worker/runner";
function clock(){let time=0;return {now:()=>time,advance:(n:number)=>{time+=n},sleep:async(n:number)=>{time+=n}}}
test("idle polling stays available until the bounded duration",async()=>{
 const c=clock();const result=await runWorker(async()=>false,{durationSeconds:3,pollIntervalMs:2000,...c});
 assert.deepEqual(result,{ticks:2,processed:0,failures:0,reason:"duration"});assert.equal(c.now(),3000);
});
test("a busy queue drains without unnecessary sleeps and completes its in-flight tick",async()=>{
 const c=clock();let sleeps=0;
 const result=await runWorker(async()=>{c.advance(750);return true},{durationSeconds:2,now:c.now,sleep:async()=>{sleeps++}});
 assert.equal(result.ticks,3);assert.equal(result.processed,3);assert.equal(sleeps,0);assert.equal(c.now(),2250);
});
test("shutdown releases the current tick before returning and avoids another claim",async()=>{
 const c=clock(),shutdown=new AbortController();let completed=false;
 const result=await runWorker(async()=>{await Promise.resolve();completed=true;shutdown.abort();return true},{signal:shutdown.signal,...c});
 assert.equal(completed,true);assert.equal(result.ticks,1);assert.equal(result.reason,"signal");
});
test("an already stopped runner never claims a job",async()=>{
 const shutdown=new AbortController();shutdown.abort();let ticks=0;
 const result=await runWorker(async()=>{ticks++;return false},{signal:shutdown.signal});
 assert.equal(ticks,0);assert.equal(result.reason,"signal");
});
test("repeated infrastructure failures make Actions fail and leave jobs resumable",async()=>{
 const c=clock();let errors=0;
 await assert.rejects(()=>runWorker(async()=>{throw Error("offline")},{durationSeconds:20,...c,onError:()=>{errors++}}),(error:unknown)=>{
  assert.ok(error instanceof WorkerConnectivityError);assert.equal(error.summary.failures,3);return true;
 });
 assert.equal(errors,3);
});
test("a successful tick resets consecutive infrastructure failures",async()=>{
 const c=clock();let tick=0;
 const result=await runWorker(async()=>{tick++;c.advance(1000);if([1,2,4,5].includes(tick))throw Error("transient");return false},{durationSeconds:12,pollIntervalMs:1,...c});
 assert.equal(result.failures,4);assert.ok(result.ticks>5);
});
test("poll sleep wakes promptly on shutdown",async()=>{
 const shutdown=new AbortController();let ticks=0;
 const run=runWorker(async()=>{ticks++;return false},{signal:shutdown.signal,pollIntervalMs:10000});
 setTimeout(()=>shutdown.abort(),5);const result=await run;
 assert.equal(result.reason,"signal");assert.equal(ticks,1);
});
test("durations reject unbounded or malformed CLI input",()=>{
 assert.equal(workerDuration(["--duration-seconds","180"],undefined),180);
 assert.equal(workerDuration([],"240"),240);assert.equal(workerDuration([],undefined),undefined);
 for(const args of [["--duration-seconds"],["--duration-seconds","0"],["--duration-seconds","1.5"],["--duration-seconds","86401"],["180"],["--duration-seconds","10","20"],["--other","10"]]){
  assert.throws(()=>workerDuration(args,undefined));
 }
});
test("invalid runner options fail before claiming",async()=>{
 let ticks=0;await assert.rejects(()=>runWorker(async()=>{ticks++;return false},{durationSeconds:0}));
 await assert.rejects(()=>runWorker(async()=>{ticks++;return false},{pollIntervalMs:0}));
 assert.equal(ticks,0);
});
