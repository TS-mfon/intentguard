import test from "node:test";
import assert from "node:assert/strict";
import {STEPS,validateBudgetAuthority,enforceBudget,budgetCommitment,sealStageQuote} from "../tools/production/deploy-existing-cpu.mjs";
import {privateKeyToAccount} from "viem/accounts";
import {validateSigned} from "../tools/production/mainnet-deploy.mjs";

const scope=()=>({version:1,kind:"user-budget-authorized-existing-cpu-deployment",chainId:196,deployer:"0x"+"12".repeat(20),approvedBy:"user",authorizationReference:"User response: Use an existing official CPU within the OKB budget",maximumNativeWei:"4700000000000000",maximumTokenSpend:"0",steps:[...STEPS],sourceCommit:"ab".repeat(20),sourceTreeSha256:"cd".repeat(32),proofSha256:"ef".repeat(32),proofPath:".local/proof.json",gasPriceCeilingWei:"30000000"});

test("scope refuses another chain, token spend, extra operation, missing authority, or enlarged budget",()=>{
 assert.doesNotThrow(()=>validateBudgetAuthority(scope()));
 for(const replacement of [{chainId:1952},{maximumTokenSpend:"1"},{steps:[...STEPS,"transfer"]},{approvedBy:"agent"},{authorizationReference:"automatic approval"},{maximumNativeWei:"4742022719283113"},{gasPriceCeilingWei:"30000001"}])assert.throws(()=>validateBudgetAuthority({...scope(),...replacement}));
});
test("pending signed transactions reserve their worst-case cost while confirmed transactions count actual cost",()=>{
 const journal={entries:{mintTransistors:{status:"VERIFIED",actualCostWei:"660000000000000",quote:{maximumCostWei:"680000000000000"}},tapeout:{status:"PENDING",quote:{maximumCostWei:"2000000000000000"}}}};
 assert.equal(budgetCommitment(journal),2660000000000000n);
 assert.equal(enforceBudget(scope(),journal,"2040000000000000"),4700000000000000n);
 assert.throws(()=>enforceBudget(scope(),journal,"2040000000000001"));
});
test("an interrupted or reverted stage cannot free its spending commitment for a replacement transaction",()=>{
 const journal={entries:{mintTransistors:{status:"INTENT",quote:{maximumCostWei:"700000000000000"}},tapeout:{status:"REVERTED",actualCostWei:"100000000000000",quote:{maximumCostWei:"2000000000000000"}}}};
 assert.equal(budgetCommitment(journal),800000000000000n);
 assert.throws(()=>enforceBudget(scope(),journal,"4000000000000000"));
 assert.throws(()=>budgetCommitment({entries:{unknown:{status:"INTENT",quote:{maximumCostWei:"1"}}}}));
});
test("budget quote envelope binds the chain used by the actual signed-transaction validator",async()=>{
 const account=privateKeyToAccount("0x"+"01".repeat(32));
 const transaction={sender:account.address.toLowerCase(),to:"0x"+"12".repeat(20),data:"0x12345678",valueWei:"0",nonce:"0",gasLimit:"100000",gasPriceWei:"21000000",type:"legacy",chainId:196};
 const quote=sealStageQuote({transaction});assert.equal(quote.chainId,196);
 const raw=await account.signTransaction({type:"legacy",chainId:196,to:transaction.to,data:transaction.data,value:0n,nonce:0,gas:100000n,gasPrice:21000000n});
 assert.match(await validateSigned(raw,quote),/^0x[0-9a-f]{64}$/);
 assert.throws(()=>sealStageQuote({transaction:{...transaction,chainId:1952}}));
});
