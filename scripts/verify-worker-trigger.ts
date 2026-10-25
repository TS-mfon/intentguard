import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {loadEnvFile} from "node:process";
import {privateKeyToAccount} from "viem/accounts";
import type {Hex} from "viem";
import {database} from "../apps/web/lib/store";
import type {Draft} from "../apps/web/lib/models";
import {GenLayer} from "../apps/web/lib/genlayer";
import {canonical,digest} from "../packages/shared";
loadEnvFile(".local/testnet-secrets.env");loadEnvFile(".local/hosting.env");
assert.equal(process.env.INTENTGUARD_MODE,"testnet");assert.equal(process.env.XLAYER_CHAIN_ID,"1952");
const base=process.env.APP_URL!,repo="TS-mfon/intentguard",userId="0x5265d227519c96e186cda7e45d072d18751dca8da58615ca8832bd78527faf37";
const journal=".local/worker-wake-check.json";
type Run={id:number;status:string;conclusion:string|null;head_sha:string;event:string;created_at:string;html_url:string};
type State={startedAt:string;draftId:string;userDraftHash:string;head:string;before:number[];workerRun?:Run;completedAt?:string};
const runs=()=>JSON.parse(execFileSync("gh",["api","repos/"+repo+"/actions/workflows/worker.yml/runs?per_page=20"],{stdio:["ignore","pipe","pipe"]}).toString()).workflow_runs as Run[];
const save=(state:State)=>writeFile(journal,JSON.stringify(state,null,2)+"\n",{mode:0o600});
try{
 const store=await database();let state:State|undefined;
 try{state=JSON.parse(await readFile(journal,"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 if(!state){
  const before=runs();assert.ok(!before.some(run=>run.status!=="completed"),"Wait for existing worker runs to finish before testing admission");
  const original=await store.get<Draft>("drafts",userId);assert.ok(original);assert.equal(original.state,"FINALIZED");
  const acceptance=JSON.parse(await readFile("docs/deployments/acceptance.json","utf8"));
  const template=await store.get<Draft>("drafts",acceptance.draftId);assert.ok(template);
  const account=privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex);
  const challenge=await fetch(base+"/api/v1/auth/challenge",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({address:account.address}),signal:AbortSignal.timeout(20000)});
  assert.equal(challenge.status,200);const {message}=await challenge.json();
  assert.equal(message.split("\n")[1],new URL(base).host);
  const login=await fetch(base+"/api/v1/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({address:account.address,signature:await account.signMessage({message})}),signal:AbortSignal.timeout(20000)});
  assert.equal(login.status,200);const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const startedAt=new Date().toISOString(),head=execFileSync("git",["rev-parse","HEAD"]).toString().trim();
  // This verifier never dispatches Actions: only the hosted API can start it.
  const response=await fetch(base+"/api/v1/owner/drafts",{method:"POST",headers:{"Content-Type":"application/json",Origin:base,Cookie:cookie},body:JSON.stringify(template.input),signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,202);const admitted=await response.json();
  state={startedAt,draftId:admitted.id,userDraftHash:digest(original),head,before:before.map(r=>r.id)};await save(state);
  console.log("HOSTED_PROPOSAL_ADMITTED",admitted.id);
 }
 const deadline=Date.now()+660000;let previous="";
 while(Date.now()<deadline){
  const candidates=runs().filter(run=>!state!.before.includes(run.id)&&Date.parse(run.created_at)>=Date.parse(state!.startedAt)-1000);
  const run=candidates.find(r=>r.head_sha===state!.head&&r.event==="workflow_dispatch");if(run){state.workerRun=run;await save(state);}
  const draft=await store.get<Draft>("drafts",state.draftId);assert.ok(draft);
  const progress=JSON.stringify({draftId:state.draftId,draftState:draft.state,workerRun:run?.id,workerStatus:run?.status,workerConclusion:run?.conclusion});
  if(progress!==previous){console.log(progress);previous=progress;}
  if(run?.status==="completed"&&run.conclusion!=="success")throw Error("Automatically dispatched worker failed");
  if(draft.state==="FINALIZED"&&run?.status==="completed"){
   assert.equal(run.conclusion,"success");
   const result=await new GenLayer(store).draft(draft);
   assert.equal(result.status,"PROPOSED");assert.equal(canonical(result),canonical(draft.result));
   assert.equal(canonical(result.policy),canonical(draft.input.guidance));
   const original=await store.get<Draft>("drafts",userId);assert.equal(digest(original),state.userDraftHash,"User draft must remain intact");
   state.completedAt=new Date().toISOString();await save(state);
   const report={mode:"REAL_HOSTED_API_AUTOMATIC_ACTIONS_WAKE",appUrl:base,startedAt:state.startedAt,completedAt:state.completedAt,commit:state.head,draftId:state.draftId,genLayerTxHash:draft.genLayerTxHash,workerRun:run,userDraftId:userId,userDraftPreserved:true,paymentSubmissions:0};
   await writeFile("docs/deployments/worker-wake.json",JSON.stringify(report,null,2)+"\n");
   console.log("HOSTED_AUTOMATIC_WORKER_VERIFIED");process.exit(0);
  }
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 throw Error("Automatic hosted worker verification timed out");
}catch(error){console.error("HOSTED_AUTOMATIC_WORKER_CHECK_FAILED",error instanceof Error?error.message:"Verification failed");process.exit(1);}
