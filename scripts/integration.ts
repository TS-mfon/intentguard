import assert from "node:assert/strict";
import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";
import {runEvmIntegration} from "../contracts/evm/integration";
import {createApi} from "../apps/web/lib/api";
import {issueKey} from "../apps/web/lib/auth";
import {Worker} from "../apps/web/lib/worker";
import {PendingFinality,type GenLayerPort} from "../apps/web/lib/genlayer";
import type {Payment,Card} from "../apps/web/lib/models";
import {digest,type Policy,type ReviewDecision,parseAmount} from "../packages/shared";
const report=await runEvmIntegration(async ctx=>{
 const recipient=privateKeyToAccount(generatePrivateKey()).address,now=Math.floor(Date.now()/1000);
 const policy:Policy={version:1,name:"API pipeline",mission:"Purchase verified research data",taskContext:"Explicit isolated end-to-end fixture",allowedCategories:["data"],prohibitedPurchases:[],exceptions:[],financial:{totalBudget:"2",perPaymentLimit:"1",periodBudget:"2",periodSeconds:86400,validFrom:now-60,validUntil:now+3600},merchants:[{name:"Isolated vendor",recipient,origins:["https://merchant.invalid"],products:["Research data"]}],evidence:{requiredTypes:["invoice"],approvedOrigins:["https://merchant.invalid"],maxAgeSeconds:600},criteria:[{id:"invoice",description:"The invoice matches the intended research purchase"}]};
 const card=await ctx.createCard(policy);await ctx.store.create("cards",card);await ctx.fund(card.address,"2");const key=await issueKey(ctx.store,card._id,card.owner);
 const api=createApi(ctx.store,ctx.evm,{requireConfigured:false});let finalized=false,reject=false,submissions=0;
 const gl:GenLayerPort={
 propose:async()=>{throw Error("Unused test-only proposal port")},draft:async()=>{throw Error("Unused test-only draft port")},deployReviewer:async()=>{throw Error("Unused test-only deploy port")},reviewer:async()=>{throw Error("Unused test-only reviewer port")},
 submit:async()=>{submissions++;return digest("TEST ONLY finalized transaction "+submissions)},
 decision:async(c:Card,p:Payment):Promise<ReviewDecision>=>{if(!finalized)throw new PendingFinality("TEST ONLY accepted, not final");return {decision:reject?"REJECT":"APPROVE",requestHash:p.requestHash!,policyHash:c.policyHash,evidenceHash:p.evidenceHash!,criteria:[{id:"invoice",status:reject?"FAIL":"PASS",reason:"TEST ONLY independent review fixture",sources:p.input.evidence.map(e=>e.url)}],reason:"TEST ONLY finalized review; no foreign-chain consensus claimed"}}
 };
 const invoice=(id:string)=>JSON.stringify({invoiceId:id,buyer:card.address,token:card.token,chainId:31337,recipient,amount:"1",description:"Research data",issuedAt:now,expiresAt:now+1800});
 const worker=new Worker(ctx.store,ctx.evm,gl,async url=>invoice(new URL(url).pathname.split("/").at(-1)!));
 const submit=async(id:string)=>{const body={recipient,amount:"1",purchaseDescription:"Research data",justification:"Needed for the approved research mission",category:"data",invoiceId:id,evidence:[{url:"https://merchant.invalid/invoice/"+id}]};
 const response=await api(new Request("http://localhost:3000/api/v1/requests",{method:"POST",headers:{Authorization:"Bearer "+key,"Idempotency-Key":id,"Content-Type":"application/json"},body:JSON.stringify(body)}),"/requests");assert.equal(response.status,202);return (await response.json()).id as string;};
 const step=async(id:string)=>{const p=(await ctx.store.get<Payment>("requests",id))!;const update=await worker.payment(p);await ctx.store.patch("requests",id,update);return (await ctx.store.get<Payment>("requests",id))!};
 const first=await submit("invoice-pipeline-approve");assert.equal(await submit("invoice-pipeline-approve"),first);
 await step(first);assert.equal((await ctx.evm.request(card,first)).status,0);await step(first);assert.equal((await ctx.evm.request(card,first)).status,1);await step(first);
 await assert.rejects(()=>step(first),PendingFinality);assert.equal(await ctx.balance(recipient),0n);
 finalized=true;assert.equal((await step(first)).status,"APPROVED");assert.equal(await ctx.balance(recipient),0n);assert.equal((await step(first)).status,"PAID");assert.equal(await ctx.balance(recipient),parseAmount("1"));
 assert.equal((await step(first)).status,"PAID");assert.equal(submissions,1);assert.equal(await ctx.balance(recipient),parseAmount("1"));
 // Remove the local transaction journal to exercise independent Paid-event recovery.
 const paid=await ctx.store.take("transactions",first+":settle");assert.ok(paid);assert.match(await ctx.evm.paidHash(card,(await ctx.store.get<Payment>("requests",first))!),/^0x[0-9a-f]{64}$/i);
 const second=await submit("invoice-pipeline-reject");await step(second);await step(second);await step(second);reject=true;assert.equal((await step(second)).cancelTarget,"REJECTED");assert.equal((await step(second)).status,"REJECTED");
 const view=await ctx.evm.view(card);assert.equal(view.balances.reserved,"0");assert.equal(view.balances.available,"1");assert.equal(await ctx.balance(recipient),parseAmount("1"));
 console.log("API_TO_WORKER_REAL_VAULT_PIPELINE_PASSED");
});
console.log(JSON.stringify({...report,fullPipeline:"TEST_ONLY_GENLAYER_PORT_WITH_REAL_API_WORKER_VAULT"},null,2));
