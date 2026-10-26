import {test} from "node:test";
import assert from "node:assert/strict";
import {assertSemanticOutcome,latencyReport,semanticThresholds,validateCaseCounts,assertDeclaredScenario} from "../scripts/audit-production-semantic";
const base={id:"0x"+"11".repeat(32),status:"REJECTED",review:{decision:"REJECT"},reviewStage:{status:"COMPLETE"},genLayerTxHash:"0x"+"22".repeat(32)} as any;
test("semantic acceptance never credits cancellation as finalized rejection",()=>{
 const expected={status:"REJECTED",decision:"REJECT",reviewStage:"COMPLETE",payment:false} as const;
 assertSemanticOutcome(base,expected);
 for(const changed of [{status:"CANCELLED",review:undefined,reviewStage:{status:"FAILED"}},{status:"REJECTED",reviewStage:{status:"FAILED"}},{genLayerTxHash:undefined},{paymentTxHash:"0x"+"33".repeat(32)}])assert.throws(()=>assertSemanticOutcome({...base,...changed},expected));
});
test("a durable admission or approval cannot be counted as a delivered payment",()=>{
 const expected={status:"PAID",decision:"APPROVE",reviewStage:"COMPLETE",payment:true} as const;
 assert.throws(()=>assertSemanticOutcome({...base,status:"APPROVED",review:{decision:"APPROVE"}},expected));
 assert.throws(()=>assertSemanticOutcome({...base,status:"PAID",review:{decision:"APPROVE"}},expected));
 assertSemanticOutcome({...base,status:"PAID",review:{decision:"APPROVE"},paymentTxHash:"0x"+"33".repeat(32)},expected);
});
test("latency thresholds are declared before live execution and fail oversized samples",()=>{assert.equal(latencyReport([100,200,300]).pass,true);assert.equal(latencyReport([semanticThresholds.p95CompletionMs+1]).pass,false);assert.throws(()=>latencyReport([]));});

test("release acceptance requires ten fresh cases per core group and cannot declare unsafe purchases paid",()=>{
 const cases=[...Array(10).fill({name:"valid"}),...Array(10).fill({name:"prohibited"}),...Array(10).fill({name:"prompt-injection"}),...Array(10).fill({name:"evidence-hash"}),{name:"budget"},{name:"consensus-failure"}];
 validateCaseCounts(cases);assert.throws(()=>validateCaseCounts(cases.slice(1)));assertDeclaredScenario("prohibited",{status:"REJECTED",decision:"REJECT",reviewStage:"COMPLETE",payment:false});
 assert.throws(()=>assertDeclaredScenario("prohibited",{status:"PAID",decision:"APPROVE",reviewStage:"COMPLETE",payment:true}));
 assert.throws(()=>assertDeclaredScenario("prompt-injection",{status:"CANCELLED",decision:null,reviewStage:"FAILED",payment:false}));
});
