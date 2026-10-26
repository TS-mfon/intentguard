import {test} from "node:test";
import assert from "node:assert/strict";
import {settlementFixture} from "./settlement-security-fixture";
test("S06 intermediate progress cannot reset the thirty-minute pre-burn deadline",async()=>{
 const t=await settlementFixture();await t.store.patch("requests",t.p._id,{processingStartedAt:Date.now()-31*60*1000,waitStartedAt:null});
 const values=await t.step();assert.equal(values.status,"CANCELLED");assert.equal(values.errorCode,"PROCESSING_TIMEOUT");assert.equal(t.evm.settlements,0);assert.equal(t.evm.cancellations,1);
});

test("a deadline crossed during finality is checked again before attesting",async()=>{
 const t=await settlementFixture(),clock=Date.now,original=t.gl.decision.bind(t.gl);
 try{const fixed=Date.now()+31*60*1000;t.gl.decision=async(c,p)=>{Date.now=()=>fixed;return original(c,p);};const result=await t.step();assert.equal(result.status,"CANCELLED");assert.equal(result.errorCode,"PROCESSING_TIMEOUT");assert.equal(t.evm.settlements,0);}
 finally{Date.now=clock;}
});
