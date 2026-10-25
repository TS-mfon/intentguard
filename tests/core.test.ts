import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {parseAmount,formatAmount,canonical,digest,policySchema,validateDecision} from "../packages/shared";
import {capture,publicIp,safeFetch,pinnedLookup} from "../apps/web/lib/evidence";
import {assertFinalized,PendingFinality,GenLayerTerminalError,genLayerAddress,normalizedCalldata,normalizeStudioTransaction} from "../apps/web/lib/genlayer";
import {MemoryStore} from "../apps/web/lib/store";
import {policy,input} from "./fixtures";
test("exact money covers fractions, boundaries and unsafe representations",()=>{for(const s of ["0","1","0.000001","18446744073709.551615","9007199254.740993"]){assert.equal(parseAmount(formatAmount(parseAmount(s))),parseAmount(s))}assert.equal(parseAmount("0.000001"),1n);for(const s of ["-1","+1","01","1e6","1.0000001","18446744073709.551616","NaN","1."]){assert.throws(()=>parseAmount(s))}});
test("canonical SHA256 matches independently serialized payload",()=>{const a={z:[3,{b:2,a:1}],a:"x"};assert.equal(canonical(a),'{"a":"x","z":[3,{"a":1,"b":2}]}');assert.equal(digest(a),"0x"+createHash("sha256").update('{"a":"x","z":[3,{"a":1,"b":2}]}').digest("hex"));assert.equal(digest(a),digest({a:"x",z:[3,{a:1,b:2}]}));assert.notEqual(digest([1,2]),digest([2,1]))});
test("policy schema rejects duplicate criteria, excess and invalid periods",()=>{assert.ok(policySchema.safeParse(policy).success);assert.ok(!policySchema.safeParse({...policy,criteria:[...policy.criteria,...policy.criteria]}).success);assert.ok(!policySchema.safeParse({...policy,financial:{...policy.financial,totalBudget:"1"}}).success)});
test("public evidence fetch rejects private, mapped IPv6 and disallowed transports",async()=>{for(const ip of ["127.0.0.1","10.0.0.1","172.18.0.1","169.254.169.254","100.64.0.1","::1","::ffff:127.0.0.1","fc00::1","fe80::1"]){assert.equal(publicIp(ip),false)}for(const ip of ["1.1.1.1","8.8.8.8","2606:4700:4700::1111"])assert.equal(publicIp(ip),true);for(const url of ["http://example.org","https://user:pass@example.org","https://example.org:8443","https://127.0.0.1"]){await assert.rejects(safeFetch(url))}});
test("evidence commitment detects a changed snapshot and enforces bundle limit",async()=>{const snapshots=await capture(input,async()=>"proof");assert.equal(snapshots[0].content,"proof");await assert.rejects(capture({...input,evidence:[{url:input.evidence[0].url,sha256:"00".repeat(32)}]},async()=>"proof"));await assert.rejects(capture({...input,evidence:[...input.evidence,...input.evidence,...input.evidence]},async()=>"x".repeat(1048576)))});
test("finality oracle rejects accepted, VM error, wrong target and wrong arguments",()=>{const expected={target:"0x"+"11".repeat(20),method:"review",args:["req","{}","[]"],sender:"0x"+"22".repeat(20)};const tx={statusName:"FINALIZED",txExecutionResultName:"FINISHED_WITH_RETURN",resultName:"MAJORITY_AGREE",recipient:expected.target,sender:expected.sender,txDataDecoded:{type:"call",leaderOnly:false,callData:new Map<string,unknown>([["method","review"],["args",expected.args]])}};assert.doesNotThrow(()=>assertFinalized(tx as never,expected));assert.throws(()=>assertFinalized({...tx,statusName:"ACCEPTED"} as never,expected),PendingFinality);assert.throws(()=>assertFinalized({...tx,txExecutionResultName:"FINISHED_WITH_ERROR"} as never,expected));assert.throws(()=>assertFinalized({...tx,recipient:expected.sender} as never,expected));assert.throws(()=>assertFinalized(tx as never,{...expected,args:["different"]}));assert.throws(()=>assertFinalized({...tx,txDataDecoded:null} as never,expected))});
test("leases provide single claim and fence a stale completion",async()=>{const s=new MemoryStore();await s.create("jobs",{_id:"1",status:"pending"});const [a,b]=await Promise.all([s.claim("jobs",{status:"pending"},100,10),s.claim("jobs",{status:"pending"},100,10)]);assert.ok(a);assert.equal(b,null);const replacement=await s.claim("jobs",{status:"pending"},111,10);assert.ok(replacement);assert.equal(await s.complete("jobs","1",String(a.leaseToken),{status:"bad"}),false);assert.equal(await s.complete("jobs","1",String(replacement.leaseToken),{status:"done"}),true)});

test("GenLayer constructor address uses the SDK Address wire type",async()=>{const {abi:{calldata}}=await import("genlayer-js");const value=genLayerAddress("0x"+"12".repeat(20));const decoded=calldata.decode(calldata.encode(value));assert.equal(normalizedCalldata(decoded),"0x"+"12".repeat(20));assert.deepEqual(normalizedCalldata(new Map([["args",[decoded,"policy"]]])),{args:["0x"+"12".repeat(20),"policy"]})});
test("finality requires successful consensus and full validator participation",()=>{const base={status:7,txExecutionResult:1,result:6,txDataDecoded:{type:"call",leaderOnly:false,callData:{method:"review",args:[]}}};assert.doesNotThrow(()=>assertFinalized(base as never));assert.throws(()=>assertFinalized({...base,result:7} as never));assert.throws(()=>assertFinalized({...base,txDataDecoded:{...base.txDataDecoded,leaderOnly:true}} as never));assert.throws(()=>assertFinalized({...base,txDataDecoded:{type:"call"}} as never))});

test("Studionet committed call normalization preserves finality, VM failure and hash checks",async()=>{
 const {abi:{calldata}}=await import("genlayer-js");
 const {toHex,toRlp}=await import("viem");
 const hash="0x"+"ab".repeat(32),target="0x"+"11".repeat(20),sender="0x"+"22".repeat(20);
 const args=["request","{}","[]"],tx_data=toRlp([toHex(calldata.encode({method:"review",args})),"0x"]).slice(2);
 const raw={hash,status:"FINALIZED",result_name:"MAJORITY_AGREE",recipient:target,sender,tx_data,consensus_data:{leader_receipt:[{execution_result:"SUCCESS"}]}};
 const normalize=(v:unknown)=>normalizeStudioTransaction(v as never,hash);
 assert.doesNotThrow(()=>assertFinalized(normalize(raw),{target,method:"review",args,sender}));
 assert.throws(()=>assertFinalized(normalize({...raw,status:"ACCEPTED"})),PendingFinality);
 assert.throws(()=>assertFinalized(normalize({...raw,consensus_data:{leader_receipt:[{execution_result:"SUCCESS"},{execution_result:"ERROR"}]}})));
 assert.throws(()=>assertFinalized(normalize({...raw,consensus_data:{}})));
 assert.throws(()=>normalize({...raw,hash:"0x"+"cd".repeat(32)}));
 assert.throws(()=>assertFinalized(normalize(raw),{target,method:"review",args:["changed"],sender}));
});

test("GenLayer decoded constructor integers normalize exactly and reject unsafe JSON values",()=>{assert.deepEqual(normalizedCalldata(new Map([["args",[genLayerAddress("0x"+"12".repeat(20)),"policy","hash",1952n]]])),{args:["0x"+"12".repeat(20),"policy","hash",1952]});assert.throws(()=>normalizedCalldata(9007199254740993n),/exact JSON range/)});

test("pinned DNS lookup supports Node dual-stack and single-address callback contracts",()=>{
 for(const chosen of [{address:"1.1.1.1",family:4},{address:"2606:4700:4700::1111",family:6}]){
  for(const all of [true,false]){
   let calls=0;
   pinnedLookup(chosen)("changed.example",{all},(error,address,family)=>{
    calls++;assert.equal(error,null);
    if(all){assert.deepEqual(address,[chosen]);assert.equal(family,undefined)}
    else{assert.equal(address,chosen.address);assert.equal(family,chosen.family)}
   });
   assert.equal(calls,1);
  }
 }
});

test("terminal consensus and finalized VM failures differ from pending finality",()=>{
 for(const statusName of ["CANCELED","UNDETERMINED","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"])assert.throws(()=>assertFinalized({statusName} as any),GenLayerTerminalError);
 assert.throws(()=>assertFinalized({statusName:"ACCEPTED"} as any),PendingFinality);
 assert.throws(()=>assertFinalized({statusName:"FINALIZED",txExecutionResultName:"FINISHED_WITH_ERROR"} as any),GenLayerTerminalError);
 assert.throws(()=>assertFinalized({statusName:"FINALIZED",txExecutionResultName:"FINISHED_WITH_RETURN",resultName:"MAJORITY_DISAGREE"} as any),GenLayerTerminalError);
});
