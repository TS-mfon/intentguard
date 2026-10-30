/** Real public testnet acceptance. --verify never admits a new request. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,access} from "node:fs/promises";
import {chromium} from "@playwright/test";
import {createPublicClient,http,decodeEventLog,parseAbi} from "viem";
import {SandboxClient} from "../packages/sdk/client.mjs";
import {CCTP_TESTNETS} from "../packages/shared/assets";

const origin="https://intentguard-tapeout.vercel.app",file=".local/visitor-release/hosted-sandbox.json";
const sandboxId="0xe199f50dcce9437b3431fd161759c6cce6563c5f070135c04e03445b8c4b4366",sandboxAddress="0x3C652BCa51252dc72BF4eE32205cD10AEE97D5c5";
const mode=process.argv[2];assert.ok(["--execute","--verify"].includes(mode),"Choose --execute or read-only --verify");
const expected:Record<string,string>={blocked:"BLOCKED",permitted:"PAID",prohibited:"REJECTED","wrong-buyer":"NEEDS_EVIDENCE"};
const terminal=new Set(["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","CANCELLED","EXPIRED"]);
const evm=createPublicClient({transport:http("https://testrpc.xlayer.tech",{timeout:30000,retryCount:2})});
const tokenAbi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
async function json(path:string){const r=await fetch(origin+"/api/v1"+path,{redirect:"error",credentials:"omit",signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);return r.json();}
async function verifyRecord(row:any,card:any){
 const result=await json("/explorer/transactions/"+row.id),t=result.transaction;
 assert.equal(t.id,row.id);assert.equal(t.cardId,card.id);assert.equal(t.chainId,1952);assert.equal(t.paymentEnvironment,"testnet");assert.equal(t.reviewEnvironment,"testnet");assert.equal(t.reviewChainId,61999);assert.equal(t.destinationChainId,1952);assert.equal(t.token.toLowerCase(),CCTP_TESTNETS[1952].token.toLowerCase());assert.equal(t.status,expected[row.scenario]);assert.equal(t.bridge,undefined);
 assert.equal(t.amount,row.scenario==="blocked"?"0.010001":"0.000001");
 if(row.scenario==="permitted"){
  assert.equal(t.review.decision,"APPROVE");assert.equal(result.reasoningSource,"genlayer-finalized-contract");assert.match(t.genLayerTxHash,/^0x[a-f0-9]{64}$/i);assert.match(t.paymentTxHash,/^0x[a-f0-9]{64}$/i);
  assert.equal(await evm.getChainId(),1952);const receipt=await evm.getTransactionReceipt({hash:t.paymentTxHash});assert.equal(receipt.status,"success");
  const transfers=receipt.logs.filter(l=>l.address.toLowerCase()===CCTP_TESTNETS[1952].token.toLowerCase()).flatMap(l=>{try{return [decodeEventLog({abi:tokenAbi,data:l.data,topics:l.topics}).args];}catch{return[];}});
  assert.equal(transfers.filter(a=>a.from?.toLowerCase()===card.address.toLowerCase()&&a.to?.toLowerCase()===t.recipient.toLowerCase()&&a.value===1n).length,1,"Exact native-USDC vault transfer required");
 }else{
  assert.ok(!t.paymentTxHash);if(row.scenario==="prohibited"){assert.equal(t.review.decision,"REJECT");assert.equal(result.reasoningSource,"genlayer-finalized-contract");assert.match(t.genLayerTxHash,/^0x[a-f0-9]{64}$/i);}
  if(row.scenario==="blocked"){assert.ok(!t.review&&!t.genLayerTxHash,"Numerical denial must skip review");assert.equal(t.guard.allow,false);assert.equal(result.reviewStage.status,"SKIPPED");}
  if(row.scenario==="wrong-buyer")assert.ok(!t.review&&!t.genLayerTxHash,"Wrong-buyer evidence must fail before semantic review");
 }
 return {id:row.id,scenario:row.scenario,status:t.status,amount:t.amount,genLayerTxHash:t.genLayerTxHash??null,paymentTxHash:t.paymentTxHash??null,publicUrl:origin+"/explorer/transactions/"+row.id};
}
await mkdir(".local/visitor-release",{recursive:true});
let report:any;
if(mode==="--verify")report=JSON.parse(await readFile(file,"utf8"));
else{
 assert.equal(await access(file).then(()=>true,()=>false),false,"An acceptance run already exists. Use --verify to inspect its actual records; do not create duplicate requests.");
 const config=await json("/config"),sandbox=await json("/sandbox");assert.equal(config.mode,"testnet");assert.equal(config.chainId,1952);assert.equal(sandbox.enabled,true);assert.equal(sandbox.paymentChainId,1952);
 assert.equal(sandbox.card.id,sandboxId);assert.equal(sandbox.card.address.toLowerCase(),sandboxAddress.toLowerCase());
 report={version:1,scope:"four real anonymous testnet sandbox scenarios; does not replace the original semantic audits",status:"PENDING",sourceCommit:config.sourceCommit,origin,card:{id:sandbox.card.id,address:sandbox.card.address},createdAt:new Date().toISOString(),requests:[]};
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const started=Date.now();
  await page.goto(origin+"/sandbox");await page.locator('.sandbox-scenarios input[value="blocked"]').check();await page.getByRole("button",{name:"Submit testnet request",exact:true}).click();
  await page.locator(".sandbox-records code").first().waitFor({timeout:45000});const id=(await page.locator(".sandbox-records code").first().textContent())!.trim();assert.match(id,/^0x[a-f0-9]{64}$/i);
  assert.equal((await json("/explorer/transactions/"+id)).transaction.status,"BLOCKED");report.firstBlockedMs=Date.now()-started;assert.ok(report.firstBlockedMs<=60000,"Anonymous first use exceeded 60 seconds");
  assert.deepEqual(await context.cookies(),[]);assert.equal(await page.evaluate(()=>Boolean((window as any).ethereum)),false);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes("visitorToken")),false);assert.deepEqual(errors,[]);
  await page.screenshot({path:".local/visitor-release/hosted-sandbox-blocked.png",fullPage:true});report.browser={walletConnected:false,cookies:0,pageErrors:errors};report.requests.push({id,scenario:"blocked"});
 }finally{await browser.close();}
 await writeFile(file,JSON.stringify(report,null,2)+"\n",{mode:0o600});
 const client=new SandboxClient({baseUrl:origin,paymentEnvironment:"testnet",frontendOrigin:origin,sourceChainId:1952,expectedSourceCommit:report.sourceCommit,expectedCardId:report.card.id,requestTimeoutMs:30000});
 try{
  await client.startSession();for(const scenario of ["permitted","prohibited","wrong-buyer"] as const){const key="hosted-"+randomUUID(),admitted=await client.request(scenario,key);report.requests.push({id:admitted.id,scenario});await writeFile(file,JSON.stringify(report,null,2)+"\n",{mode:0o600});assert.equal((await client.request(scenario,key)).id,admitted.id,"Same-key retry must recover the original request");}
 }finally{client.clearSession();}
 assert.equal(new Set(report.requests.map((r:any)=>r.id)).size,4);
 const deadline=Date.now()+30*60*1000;
 while(Date.now()<deadline){const current=[];for(const row of report.requests){const t=(await json("/explorer/transactions/"+row.id)).transaction;current.push({id:row.id,scenario:row.scenario,status:t.status});}
  report.current=current;report.updatedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(current));if(current.every(r=>terminal.has(r.status)))break;await new Promise(r=>setTimeout(r,15000));}
}
assert.equal(report.requests.length,4,"All four actual scenarios must be present");
assert.equal(report.card.id,sandboxId);assert.equal(report.card.address.toLowerCase(),sandboxAddress.toLowerCase());assert.equal(new Set(report.requests.map((r:any)=>r.scenario)).size,4);assert.ok(report.firstBlockedMs<=60000);assert.deepEqual(report.browser,{walletConnected:false,cookies:0,pageErrors:[]});
assert.equal((await json("/config")).sourceCommit,report.sourceCommit,"Hosted source changed during acceptance");
report.results=[];for(const row of report.requests)report.results.push(await verifyRecord(row,report.card));
report.status="VERIFIED";report.verifiedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({status:report.status,sourceCommit:report.sourceCommit,firstBlockedMs:report.firstBlockedMs,results:report.results}));console.log("HOSTED_SANDBOX_VERIFIED");
process.exit(0);
