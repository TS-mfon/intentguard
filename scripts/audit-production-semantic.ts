import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {z} from "zod";
import {paymentSchema,parseAmount,type RequestView} from "../packages/shared";
import {parseStrictJson} from "../packages/shared/strict-json";
const outcome=z.object({status:z.enum(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","CANCELLED"]),decision:z.enum(["APPROVE","REJECT","NEEDS_EVIDENCE"]).nullable(),reviewStage:z.enum(["COMPLETE","SKIPPED","PENDING","FAILED"]),payment:z.boolean()}).strict();
const casesSchema=z.object({version:z.literal(1),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),releaseId:z.string().min(1),paymentEnvironment:z.enum(["testnet","mainnet"]),cases:z.array(z.object({name:z.enum(["valid","budget","prohibited","prompt-injection","buyer-mismatch","evidence-hash","consensus-failure"]),input:paymentSchema,expected:outcome}).strict()).min(42).max(120)}).strict();
export const semanticThresholds={maxCompletionMs:70*60*1000,p95CompletionMs:30*60*1000,cctpP95CompletionMs:60*60*1000,queueP95Ms:10*60*1000,cancellationP95Ms:10*60*1000,preBurnDeadlineMs:30*60*1000,pollIntervalMs:5000,observationClockSkewMs:30000,admissionMaxMs:30000,unexpectedTerminalFailures:0} as const;
type Expected=z.infer<typeof outcome>;
export function validateCaseCounts(cases:{name:string}[]){
 const count=(names:string[])=>cases.filter(c=>names.includes(c.name)).length;
 for(const [names,minimum] of [[["valid"],10],[["prohibited"],10],[["prompt-injection"],10],[["buyer-mismatch","evidence-hash"],10],[["budget"],1],[["consensus-failure"],1]] as const)if(count([...names])<minimum)throw Error("Insufficient fresh cases: "+names.join("/"));
}
export function assertDeclaredScenario(name:string,expected:Expected){
 const common=!expected.payment&&expected.decision!=="APPROVE";
 const permitted=name==="valid"&&expected.status==="PAID"&&expected.payment&&expected.decision==="APPROVE"&&expected.reviewStage==="COMPLETE";
 const denied=name==="prohibited"&&expected.status==="REJECTED"&&common&&expected.decision==="REJECT"&&expected.reviewStage==="COMPLETE";
 const budget=name==="budget"&&expected.status==="BLOCKED"&&common&&expected.decision===null&&expected.reviewStage==="SKIPPED";
 const evidence=["prompt-injection","buyer-mismatch","evidence-hash"].includes(name)&&common&&(["REJECTED","NEEDS_EVIDENCE"] as string[]).includes(expected.status)&&((expected.status==="REJECTED"&&expected.decision==="REJECT"&&expected.reviewStage==="COMPLETE")||(expected.status==="NEEDS_EVIDENCE"&&((expected.decision==="NEEDS_EVIDENCE"&&expected.reviewStage==="COMPLETE")||(expected.decision===null&&expected.reviewStage==="SKIPPED"))));
 const failed=name==="consensus-failure"&&expected.status==="CANCELLED"&&common&&expected.decision===null&&expected.reviewStage==="FAILED";
 if(!permitted&&!denied&&!budget&&!evidence&&!failed)throw Error("Declared outcome weakens the required scenario: "+name);
}
export function assertSemanticOutcome(actual:RequestView,expected:Expected){
 if(actual.status!==expected.status||actual.reviewStage?.status!==expected.reviewStage||(actual.review?.decision??null)!==expected.decision)throw Error("Unexpected terminal semantic outcome");
 if(Boolean(actual.paymentTxHash)!==expected.payment)throw Error("Payment receipt presence disagrees with expected outcome");
 if(expected.decision&&!/^0x[0-9a-fA-F]{64}$/.test(actual.genLayerTxHash??""))throw Error("A semantic outcome requires its finalized review transaction");
 if(expected.payment&&actual.status!=="PAID")throw Error("Only PAID can prove delivered payment");
 if(expected.status==="BLOCKED"&&(actual.genLayerTxHash||actual.review))throw Error("A budget block must skip semantic review");
}
export function latencyReport(values:number[],targetMs:number=semanticThresholds.p95CompletionMs){
 if(!values.length||values.some(v=>!Number.isFinite(v)||v<0))throw Error("Invalid latency samples");
 const sorted=[...values].sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1],median=sorted[Math.floor(sorted.length/2)];
 return {samples:values.length,medianMs:median,p95Ms:p95,thresholds:semanticThresholds,targetMs,pass:p95<=targetMs&&sorted.at(-1)!<=semanticThresholds.maxCompletionMs};
}
export function auditLedger(card:any){
 const {id,address,policyHash,chainId,token,balances}=card;
 return {id,address,policyHash,chainId,token,balances:{funded:balances.funded,spent:balances.spent,reserved:balances.reserved,available:balances.available,periodSpent:balances.periodSpent,periodReserved:balances.periodReserved}};
}
// Preserve the first observed state transitions and both clocks. Hash-pinning a
// summary alone cannot establish that its queue or completion time was measured.
export function verifyCaseMeasurements(result:any){
 const fail=(condition:boolean,message:string)=>{if(!condition)throw Error(message);};
 const timing=result.timing,observations=result.observations;
 fail(!!timing&&Array.isArray(observations)&&observations.length>0,"Raw case measurements are required");
 for(const key of ["startedAt","admittedAt","completedAt","recordCreatedAt","recordUpdatedAt"])fail(Number.isSafeInteger(timing[key])&&timing[key]>=0,"Invalid measured time: "+key);
 fail(timing.admittedAt>=timing.startedAt&&timing.admittedAt-timing.startedAt<=semanticThresholds.admissionMaxMs,"Admission time exceeds the declared bound");
 fail(Number.isSafeInteger(result.completedMs)&&result.completedMs>=0&&result.completedMs<=semanticThresholds.maxCompletionMs,"Invalid completion duration");
 fail(timing.completedAt>=timing.admittedAt&&Math.abs(timing.completedAt-timing.startedAt-result.completedMs)<=1000,"Wall and monotonic completion clocks disagree");
 fail(timing.recordCreatedAt>=timing.startedAt-semanticThresholds.observationClockSkewMs&&timing.recordCreatedAt<=timing.admittedAt+semanticThresholds.observationClockSkewMs,"Request was not created during this measured admission");
 const stages:Record<string,number>={QUEUED:0};let previousElapsed=-1,previousWall=-1,previousUpdated=-1;
 for(const observation of observations){
  fail(Number.isSafeInteger(observation.elapsedMs)&&observation.elapsedMs>=previousElapsed&&observation.elapsedMs<=result.completedMs,"Nonmonotonic observation duration");
  fail(Number.isSafeInteger(observation.observedAt)&&observation.observedAt>=previousWall&&Math.abs(observation.observedAt-timing.startedAt-observation.elapsedMs)<=1000,"Observation clocks disagree");
  fail(observation.createdAt===timing.recordCreatedAt&&Number.isSafeInteger(observation.updatedAt)&&observation.updatedAt>=observation.createdAt&&observation.updatedAt>=previousUpdated,"Server observation times changed");
  fail(observation.updatedAt<=observation.observedAt+semanticThresholds.observationClockSkewMs,"Server observation is in the future");
  fail(["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED","RETRYING","BRIDGING","AWAITING_ATTESTATION","MINTING"].includes(observation.status),"Unknown observed state");
  stages[observation.status]??=observation.elapsedMs;previousElapsed=observation.elapsedMs;previousWall=observation.observedAt;previousUpdated=observation.updatedAt;
 }
 const last=observations.at(-1);fail(last.status===result.status&&last.reviewStage===result.reviewStage.status&&last.updatedAt===timing.recordUpdatedAt,"Terminal observation differs from case result");
 fail(timing.completedAt-last.observedAt<=semanticThresholds.admissionMaxMs,"Completion was not measured at the terminal observation");
 fail(timing.recordUpdatedAt-timing.recordCreatedAt<=result.completedMs+semanticThresholds.observationClockSkewMs,"Reported duration is shorter than the independently saved request lifetime");
 fail(JSON.stringify(stages)===JSON.stringify(result.stages),"Stage times differ from raw observations");
 return {queueMs:Math.min(result.completedMs,...Object.entries(stages).filter(([status])=>status!=="QUEUED").map(([,time])=>time)),cancellationMs:result.completedMs-Number(stages.RETRYING??stages.AWAITING_FINALITY??0)};
}
async function json(url:string,token?:string,body?:unknown,idempotency?:string){
 const response=await fetch(url,{method:body===undefined?"GET":"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/json",...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json","Idempotency-Key":idempotency!})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await response.text();if(raw.length>262144)throw Error("Audit response exceeded limit");if(!response.ok)throw Error("Audit HTTP "+response.status);return parseStrictJson(raw) as any;
}
export async function runSemanticAudit(app:string,fixturePath:string,out:string){
 if(process.env.INTENTGUARD_AUDIT_EXECUTE!=="true")throw Error("Only an authorized release operator may execute live payment acceptance");
 const origin=new URL(app);if(origin.protocol!=="https:"||origin.origin!==app)throw Error("Use the canonical HTTPS application origin");
 const token=process.env.INTENTGUARD_AUDIT_AGENT_KEY;if(!token?.startsWith("ig_"))throw Error("A dedicated audit agent key is required");
 const bytes=await readFile(fixturePath),fixture=casesSchema.parse(parseStrictJson(bytes.toString("utf8")));
 validateCaseCounts(fixture.cases);for(const c of fixture.cases)assertDeclaredScenario(c.name,c.expected);
 const identity=await json(app+"/api/v1/health");if(identity.sourceCommit!==fixture.sourceCommit||identity.releaseId!==fixture.releaseId||identity.paymentEnvironment!==fixture.paymentEnvironment||identity.reviewChainId!==61999)throw Error("Fixture does not match the live release");
 const results:any[]=[],runId=createHash("sha256").update(bytes).update(String(Date.now())).digest("hex").slice(0,16);
 for(const [index,c] of fixture.cases.entries()){
  const before=await json(app+"/api/v1/me",token),started=Date.now(),monotonicStart=performance.now(),key="audit-"+runId+"-"+index+"-"+c.name,admitted=await json(app+"/api/v1/requests",token,c.input,key),admittedAt=Date.now();
  if(!/^0x[0-9a-fA-F]{64}$/.test(admitted.id))throw Error("Missing durable request ID");
  let record:RequestView|undefined;const stages:Record<string,number>={QUEUED:0},observations:any[]=[];
  while(performance.now()-monotonicStart<semanticThresholds.maxCompletionMs){
   record=await json(app+"/api/v1/requests/"+admitted.id,token) as RequestView;const elapsedMs=Math.floor(performance.now()-monotonicStart),observation={elapsedMs,observedAt:Date.now(),status:record.status,reviewStage:record.reviewStage?.status,createdAt:record.createdAt,updatedAt:record.updatedAt};stages[record.status]??=elapsedMs;
   const previous=observations.at(-1);if(!previous||previous.status!==observation.status||previous.reviewStage!==observation.reviewStage)observations.push(observation);
   if(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","CANCELLED","EXPIRED"].includes(record.status))break;
   await new Promise(resolve=>setTimeout(resolve,semanticThresholds.pollIntervalMs));
  }
  if(!record)throw Error("Request record unavailable");
  const completedMs=Math.floor(performance.now()-monotonicStart),completedAt=Date.now();let passed=true,error:string|null=null,afterLedger:any;
  try{assertSemanticOutcome(record,c.expected);if(c.expected.decision){const live=await json(app+"/api/v1/explorer/transactions/"+admitted.id);if(live.reasoningSource!=="genlayer-finalized-contract"||live.transaction.review?.decision!==c.expected.decision||live.transaction.requestHash!==record.requestHash||live.transaction.evidenceHash!==record.evidenceHash)throw Error("Finalized public contract reasoning did not match");}afterLedger=await json(app+"/api/v1/me",token);const moved=c.expected.payment?parseAmount(c.input.amount):0n;if(parseAmount(afterLedger.card.balances.reserved)!==parseAmount(before.card.balances.reserved)||parseAmount(afterLedger.card.balances.spent)-parseAmount(before.card.balances.spent)!==moved||parseAmount(before.card.balances.funded)-parseAmount(afterLedger.card.balances.funded)!==moved)throw Error("Source balance, reservation release or spent ledger did not match");if(completedMs>semanticThresholds.maxCompletionMs)throw Error("Completion deadline exceeded");}catch(e){passed=false;error=(e as Error).message;}
  const retry=await json(app+"/api/v1/requests",token,c.input,key),after=await json(app+"/api/v1/requests/"+admitted.id,token);
  if(retry.id!==admitted.id||after.paymentTxHash!==record.paymentTxHash||after.requestHash!==record.requestHash){passed=false;error="Idempotent retry changed request or receipt";}
  const result={index,name:c.name,stages,observations,timing:{startedAt:started,admittedAt,completedAt,recordCreatedAt:record.createdAt,recordUpdatedAt:record.updatedAt},ledgerBefore:auditLedger(before.card),ledgerAfter:afterLedger?auditLedger(afterLedger.card):null,bridge:Boolean(record.bridge),expected:c.expected,requestId:admitted.id,status:record.status,decision:record.review?.decision??null,reviewStage:record.reviewStage,requestHash:record.requestHash,evidenceHash:record.evidenceHash,genLayerTxHash:record.genLayerTxHash??null,paymentTxHash:record.paymentTxHash??null,completedMs,passed,error};
  try{verifyCaseMeasurements(result);}catch(e){result.passed=false;result.error=(e as Error).message;}results.push(result);
  // Persist progress without credentials or signed transaction bytes.
  const sameChain=results.filter(v=>!v.bridge),crossChain=results.filter(v=>v.bridge),queueSamples=results.map(v=>Math.min(v.completedMs,...Object.entries(v.stages).filter(([key])=>key!=="QUEUED").map(([,value])=>Number(value)))),cancellationSamples=results.filter(v=>v.name==="consensus-failure").map(v=>v.completedMs-Number(v.stages.RETRYING??v.stages.AWAITING_FINALITY??0)),latency={queue:latencyReport(queueSamples,semanticThresholds.queueP95Ms),cancellation:cancellationSamples.length?latencyReport(cancellationSamples,semanticThresholds.cancellationP95Ms):null,sameChain:sameChain.length?latencyReport(sameChain.map(v=>v.completedMs)):null,cctp:crossChain.length?latencyReport(crossChain.map(v=>v.completedMs),semanticThresholds.cctpP95CompletionMs):null},report={version:1,scope:"live semantic acceptance",runId,app,sourceCommit:fixture.sourceCommit,releaseId:fixture.releaseId,paymentEnvironment:fixture.paymentEnvironment,reviewEnvironment:"testnet",reviewNetwork:"studionet",generatedAt:new Date().toISOString(),fixtureSha256:createHash("sha256").update(bytes).digest("hex"),thresholds:semanticThresholds,results,latency,verdict:results.length===fixture.cases.length&&results.every(v=>v.passed)&&[latency.queue,latency.cancellation,latency.sameChain,latency.cctp].every(v=>v===null||v.pass)?"PASSED":"FAILED"};
  await writeFile(out,JSON.stringify(report,null,2)+"\n",{mode:0o600});if(!result.passed)throw Error("Live semantic case failed: "+c.name);if(results.length===fixture.cases.length&&report.verdict!=="PASSED")throw Error("Live acceptance exceeded the declared reliability thresholds");
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [app,fixtures,out]=process.argv.slice(2);if(!app||!fixtures||!out)throw Error("Usage: audit-production-semantic.ts <canonical-origin> <fresh-fixture.json> <report.json>");await runSemanticAudit(app,fixtures,out);}
