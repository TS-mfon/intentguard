import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {z} from "zod";
import {paymentSchema,parseAmount,type RequestView} from "../packages/shared";
import {parseStrictJson} from "../packages/shared/strict-json";
const outcome=z.object({status:z.enum(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","CANCELLED"]),decision:z.enum(["APPROVE","REJECT","NEEDS_EVIDENCE"]).nullable(),reviewStage:z.enum(["COMPLETE","SKIPPED","PENDING","FAILED"]),payment:z.boolean()}).strict();
const casesSchema=z.object({version:z.literal(1),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),releaseId:z.string().min(1),paymentEnvironment:z.enum(["testnet","mainnet"]),cases:z.array(z.object({name:z.enum(["valid","budget","prohibited","prompt-injection","buyer-mismatch","evidence-hash","consensus-failure"]),input:paymentSchema,expected:outcome}).strict()).min(42).max(120)}).strict();
export const semanticThresholds={maxCompletionMs:70*60*1000,p95CompletionMs:30*60*1000,cctpP95CompletionMs:60*60*1000,queueP95Ms:10*60*1000,cancellationP95Ms:10*60*1000,preBurnDeadlineMs:30*60*1000,pollIntervalMs:5000,unexpectedTerminalFailures:0} as const;
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
  const before=await json(app+"/api/v1/me",token),started=Date.now(),key="audit-"+runId+"-"+index+"-"+c.name,admitted=await json(app+"/api/v1/requests",token,c.input,key);
  if(!/^0x[0-9a-fA-F]{64}$/.test(admitted.id))throw Error("Missing durable request ID");
  let record:RequestView|undefined;const stages:Record<string,number>={QUEUED:0};
  while(Date.now()-started<semanticThresholds.maxCompletionMs){
   record=await json(app+"/api/v1/requests/"+admitted.id,token) as RequestView;stages[record.status]??=Date.now()-started;
   if(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","CANCELLED","EXPIRED"].includes(record.status))break;
   await new Promise(resolve=>setTimeout(resolve,semanticThresholds.pollIntervalMs));
  }
  if(!record)throw Error("Request record unavailable");
  const completedMs=Date.now()-started;let passed=true,error:string|null=null;
  try{assertSemanticOutcome(record,c.expected);if(c.expected.decision){const live=await json(app+"/api/v1/explorer/transactions/"+admitted.id);if(live.reasoningSource!=="genlayer-finalized-contract"||live.transaction.review?.decision!==c.expected.decision||live.transaction.requestHash!==record.requestHash||live.transaction.evidenceHash!==record.evidenceHash)throw Error("Finalized public contract reasoning did not match");}const afterLedger=await json(app+"/api/v1/me",token);if(parseAmount(afterLedger.card.balances.reserved)!==parseAmount(before.card.balances.reserved)||parseAmount(afterLedger.card.balances.spent)-parseAmount(before.card.balances.spent)!==(c.expected.payment?parseAmount(c.input.amount):0n))throw Error("Reservation release or spent ledger did not match");if(completedMs>semanticThresholds.maxCompletionMs)throw Error("Completion deadline exceeded");}catch(e){passed=false;error=(e as Error).message;}
  const retry=await json(app+"/api/v1/requests",token,c.input,key),after=await json(app+"/api/v1/requests/"+admitted.id,token);
  if(retry.id!==admitted.id||after.paymentTxHash!==record.paymentTxHash||after.requestHash!==record.requestHash){passed=false;error="Idempotent retry changed request or receipt";}
  results.push({index,name:c.name,stages,bridge:Boolean(record.bridge),expected:c.expected,requestId:admitted.id,status:record.status,decision:record.review?.decision??null,reviewStage:record.reviewStage,requestHash:record.requestHash,evidenceHash:record.evidenceHash,genLayerTxHash:record.genLayerTxHash??null,paymentTxHash:record.paymentTxHash??null,completedMs,passed,error});
  // Persist progress without credentials or signed transaction bytes.
  const sameChain=results.filter(v=>!v.bridge),crossChain=results.filter(v=>v.bridge),queueSamples=results.map(v=>Math.min(v.completedMs,...Object.entries(v.stages).filter(([key])=>key!=="QUEUED").map(([,value])=>Number(value)))),cancellationSamples=results.filter(v=>v.name==="consensus-failure").map(v=>v.completedMs-Number(v.stages.RETRYING??v.stages.AWAITING_FINALITY??0)),latency={queue:latencyReport(queueSamples,semanticThresholds.queueP95Ms),cancellation:cancellationSamples.length?latencyReport(cancellationSamples,semanticThresholds.cancellationP95Ms):null,sameChain:sameChain.length?latencyReport(sameChain.map(v=>v.completedMs)):null,cctp:crossChain.length?latencyReport(crossChain.map(v=>v.completedMs),semanticThresholds.cctpP95CompletionMs):null},report={version:1,scope:"live semantic acceptance",runId,app,sourceCommit:fixture.sourceCommit,releaseId:fixture.releaseId,paymentEnvironment:fixture.paymentEnvironment,reviewEnvironment:"testnet",reviewNetwork:"studionet",generatedAt:new Date().toISOString(),fixtureSha256:createHash("sha256").update(bytes).digest("hex"),thresholds:semanticThresholds,results,latency,verdict:results.length===fixture.cases.length&&results.every(v=>v.passed)&&[latency.queue,latency.cancellation,latency.sameChain,latency.cctp].every(v=>v===null||v.pass)?"PASSED":"FAILED"};
  await writeFile(out,JSON.stringify(report,null,2)+"\n",{mode:0o600});if(!passed)throw Error("Live semantic case failed: "+c.name);if(results.length===fixture.cases.length&&report.verdict!=="PASSED")throw Error("Live acceptance exceeded the declared reliability thresholds");
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [app,fixtures,out]=process.argv.slice(2);if(!app||!fixtures||!out)throw Error("Usage: audit-production-semantic.ts <canonical-origin> <fresh-fixture.json> <report.json>");await runSemanticAudit(app,fixtures,out);}
