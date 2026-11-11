import test from "node:test";
import assert from "node:assert/strict";
import {STEPS,validateBudgetAuthority,enforceBudget,budgetCommitment} from "../tools/production/deploy-existing-cpu.mjs";

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
