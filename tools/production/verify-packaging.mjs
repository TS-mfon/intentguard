import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

// Build both real entrypoints; no production credentials, RPCs or seeded app data.
// The sole test job lives in disposable local MongoDB and verifies durable retry.
const root=process.cwd(),dockerfile=readFileSync(join(root,"Dockerfile"),"utf8"),ignore=readFileSync(join(root,".dockerignore"),"utf8");
function verifyDocker(docker,exclusions){
 const bases=[...docker.matchAll(/^FROM ([^ ]+) AS ([\w-]+)$/gm)];
 assert(bases.length>=5,"Independent dependency/source/worker/build/web stages required");
 for(const[,base]of bases.filter(([,b])=>b.startsWith("node:")))assert.match(base,/^node:24\.18\.0-bookworm-slim@sha256:[0-9a-f]{64}$/);
 assert.match(docker,/corepack prepare pnpm@11\.9\.0 --activate/);
 assert.match(docker,/pnpm install --frozen-lockfile/);
 const worker=docker.split(/^FROM .* AS worker$/m)[1]?.split(/^FROM /m)[0],web=docker.split(/^FROM .* AS web$/m)[1];
 assert(worker&&web);assert.match(worker,/USER node/);assert.match(web,/USER node/);
 assert.match(worker,/CMD \["node", "node_modules\/tsx\/dist\/cli\.mjs", "apps\/worker\/main\.ts"\]/);
 assert.match(web,/CMD \["node", "apps\/web\/server\.js"\]/);
 assert.equal(bases.at(-1)[2],"web","Default target must serve HTTP");
 for(const p of [".git","**/node_modules","**/.next",".env*","**/.env*",".local",".unlazy",".venv","**/broadcast"])assert(exclusions.split("\n").includes(p),"Missing Docker exclusion "+p);
 assert(!/^ARG .*?(KEY|SECRET|MONGODB_URI)/m.test(docker));
}

verifyDocker(dockerfile,ignore);
assert.throws(()=>verifyDocker(dockerfile.replace('CMD ["node", "apps/web/server.js"]','CMD ["pnpm", "worker"]'),ignore));
assert.throws(()=>verifyDocker(dockerfile,ignore.replace(".local\n","")));
if(process.argv.includes("--structure")){console.log("PACKAGING_STRUCTURE_VERIFIED");process.exit(0)}
assert.equal(process.platform,"linux","Full container acceptance requires Linux");
const prefix="intentguard-packaging-"+randomUUID().slice(0,12),containers=[];let network=false,verified=false;
function command(binary,args,options={}){
 const r=spawnSync(binary,args,{encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024,...options});
 if(r.error||r.status!==0)throw Error(binary+" failed (exit "+r.status+"): "+(r.error?.message??[r.stderr,r.stdout].filter(Boolean).join("\n").slice(-12000)));return r.stdout.trim();
}

const docker=(args,options)=>command("docker",args,options);
const mongo=script=>docker(["exec",prefix+"-mongo","mongosh","--quiet","intentguard_packaging","--eval",script]);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 docker(["version"]);
 for(const target of ["worker","web"]){
  console.log("Building locked "+target+" target.");
  docker(["build","--quiet","--network","host","--target",target,"--tag","intentguard-packaging-"+target,"."],{timeout:15*60*1000});
  assert.equal(docker(["image","inspect","intentguard-packaging-"+target,"--format","{{.Config.User}}"]),"node");
 }
 docker(["network","create","--internal",prefix]);network=true;
 // MongoDB 8.x's tcmalloc/kernel guard refuses newer CI kernels (SERVER-121912).
 // This disposable CRUD/lease fixture uses the supported 7.0 maintenance line;
 // hosted database versions and the actual worker acceptance remain unchanged.
 const mongoName=prefix+"-mongo";docker(["run","--detach","--name",mongoName,"--network",prefix,"--network-alias","mongo","mongo:7.0.45@sha256:8bb4442761a63a8dda452744082cdac9644b429807eb977b42324a63cef59ca4"]);containers.push(mongoName);
 // A cold CI host may take longer than a warm development daemon to initialize
 // MongoDB. Bound startup, fail immediately on exit, and retain its actual logs.
 let ready=false,lastMongoError="";const mongoDeadline=Date.now()+60000;
 while(Date.now()<mongoDeadline){
  const state=JSON.parse(docker(["inspect",mongoName,"--format","{{json .State}}"]));
  assert.equal(state.Running,true,"Disposable MongoDB exited: "+JSON.stringify(state)+"\n"+docker(["logs",mongoName]));
  try{mongo("db.runCommand({ping:1})");ready=true;break}catch(error){lastMongoError=String(error.message).slice(-2000)}
  await wait(500);
 }
 assert(ready,"Disposable MongoDB did not become ready within 60s: "+lastMongoError+"\n"+docker(["logs",mongoName]));
 mongo('db.requests.insertOne({_id:"packaging-retry",cardId:"nonexistent-local-card",status:"QUEUED",createdAt:Date.now()})');
 const env={
  INTENTGUARD_MODE:"local",INTENTGUARD_PAYMENT_ENV:"local",XLAYER_CHAIN_ID:"31337",XLAYER_RPC_URL:"http://127.0.0.1:1",GENLAYER_RPC_URL:"http://127.0.0.1:1",GENLAYER_NETWORK:"studionet",
  INTENTGUARD_REPOSITORY_ROOT:"/app",MONGODB_URI:"mongodb://mongo:27017",MONGODB_DB:"intentguard_packaging",APP_URL:"http://localhost:3000",INTENTGUARD_RELEASE_ID:"packaging-local",INTENTGUARD_SOURCE_COMMIT:"a".repeat(40),
  CARD_FACTORY_ADDRESS:"0x"+"1".repeat(40),GATEWAY_ADDRESS:"0x"+"2".repeat(40),ATTESTOR_ADDRESS:"0x"+"3".repeat(40),TAPEOUT_PROCESSOR:"0x"+"4".repeat(40),TAPEOUT_CIRCUIT_ID:"0x"+"5".repeat(64),TAPEOUT_BEACON:"0x"+"6".repeat(40),TAPEOUT_IMPLEMENTATION:"0x"+"7".repeat(40),TAPEOUT_NETLIST_HASH:"0x"+"8".repeat(64),GENLAYER_INTERPRETER_ADDRESS:"0x"+"9".repeat(40),
  XLAYER_OPERATOR_PRIVATE_KEY:"0x"+"1".repeat(64),REVIEW_ATTESTOR_PRIVATE_KEY:"0x"+"2".repeat(64),GENLAYER_OPERATOR_PRIVATE_KEY:"0x"+"3".repeat(64)
 };
 const envArgs=Object.entries(env).flatMap(([n,v])=>["--env",n+"="+v]);
 const webName=prefix+"-web";
 docker(["run","--detach","--name",webName,"--network",prefix,"--network-alias","web","--read-only","--tmpfs","/tmp:rw,noexec,nosuid,size=64m",...envArgs,"intentguard-packaging-web"]);containers.push(webName);
 // An internal network intentionally has no host-published ports. A separate
 // disposable client proves the web server listens across container boundaries.
 const httpClient=String.raw`const assert=require("node:assert/strict");(async()=>{for(const path of ["/","/llms.txt"]){const response=await fetch("http://web:3000"+path,{signal:AbortSignal.timeout(4000)});assert.equal(response.status,200);assert.match(await response.text(),/IntentGuard/);}console.log("CONTAINER_HTTP_VERIFIED")})().catch(error=>{console.error(error.message);process.exit(1)})`;
 let served=false;
 for(let i=0;i<25;i++){
  if(docker(["inspect",webName,"--format","{{.State.Running}}"])!=="true")throw Error("Web target exited: "+docker(["logs",webName]));
  try{
   const result=docker(["run","--rm","--network",prefix,"--read-only","--entrypoint","node","node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d","-e",httpClient],{timeout:10000});
   assert.match(result,/CONTAINER_HTTP_VERIFIED/);served=true;break;
  }catch{}
  await wait(500);
 }
 assert(served,"Standalone web target did not serve the actual product page and public assets: "+docker(["logs",webName]));
 const workerName=prefix+"-worker";docker(["run","--detach","--name",workerName,"--network",prefix,"--read-only","--tmpfs","/tmp:rw,noexec,nosuid,size=64m",...envArgs,"intentguard-packaging-worker","node","node_modules/tsx/dist/cli.mjs","apps/worker/main.ts","--duration-seconds","10"]);containers.push(workerName);
 assert.equal(docker(["wait",workerName],{timeout:30000}),"0","Worker target did not complete: "+docker(["logs",workerName]));
 assert.match(docker(["logs",workerName]),/WORKER_RUN_COMPLETED/);
 const state=JSON.parse(mongo('print(JSON.stringify({request:db.requests.findOne({_id:"packaging-retry"}),lock:db.locks.findOne({_id:"worker"})}))'));
 assert(state.request.attempts>=1&&state.request.nextAt>state.request.createdAt,"Actual durable retry not persisted");assert.equal(state.request.errorCode,"PROCESSING_DELAYED");
 assert.equal(state.lock.leaseToken,null);assert.equal(state.lock.leaseUntil,0);

 verified=true;
}finally{
 const failures=[];
 for(const name of containers.reverse())try{docker(["rm","--force",name])}catch{failures.push("container "+name)}
 if(network)try{docker(["network","rm",prefix])}catch{failures.push("network "+prefix)}
 assert.equal(failures.length,0,"Unable to remove disposable test resources: "+failures.join(","));
}
if(verified)console.log("PACKAGING_VERIFIED");
