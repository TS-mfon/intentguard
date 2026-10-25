import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {readFile,writeFile} from "node:fs/promises";
import {parseAbi,keccak256,hexToBytes,type Address,type Hex} from "viem";
import {database} from "../apps/web/lib/store";
import {Evm} from "../apps/web/lib/evm";
import type {Card,Payment} from "../apps/web/lib/models";
import {createHash} from "node:crypto";
import {packInputs,simulate,MAX_U64} from "../circuits/policy.mjs";
loadEnvFile(".local/testnet-secrets.env");loadEnvFile(".local/hosting.env");loadEnvFile(".local/audit-agent.env");
assert.equal(process.env.INTENTGUARD_MODE,"testnet");assert.equal(process.env.XLAYER_CHAIN_ID,"1952");
const base=process.env.APP_URL!,key=process.env.INTENTGUARD_AUDIT_API_KEY!;
const journal=JSON.parse(await readFile(".local/audit12-state.json","utf8"));
const deployment=JSON.parse(await readFile("docs/deployments/testnet.json","utf8"));
const store=await database(),card=(await store.get<Card>("cards",journal.cardId))!,evm=new Evm(store);
const logs:any[]=[];
async function get(path:string,auth=false){
 const headers:Record<string,string>=auth?{Authorization:"Bearer "+key}:{};
 const response=await fetch(base+"/api/v1"+path,{headers,redirect:"error",signal:AbortSignal.timeout(45000)});
 const raw=await response.text(),safe=raw.split(key).join("[REDACTED]");assert.equal(safe,raw,"Credential must never appear in response");
 const record={request:{method:"GET",url:base+"/api/v1"+path,headers:auth?{Authorization:"[REDACTED]"}:{}},response:{status:response.status,headers:Object.fromEntries(response.headers.entries()),body:safe}};
 logs.push(record);return {status:response.status,data:JSON.parse(raw)};
}
try{
 const sample=journal.cases.find((p:any)=>p.requestId)?.requestId;assert.ok(sample);
 assert.equal((await get("/requests/"+sample)).status,401,"Anonymous callers cannot read private request views");
 assert.equal((await get("/owner/cards",true)).status,401,"Agent key cannot authorize owner operations");
 const other=(await store.find<Payment>("requests",{cardId:{$ne:card._id}},{limit:1}))[0];assert.ok(other,"Cross-card positive control must exist");
 assert.equal((await get("/requests/"+other._id,true)).status,404,"Agent key cannot read another card's private request");
 const latest=await get("/explorer/transactions?limit=4");assert.equal(latest.status,200);assert.equal(latest.data.transactions.length,4);
 for(const tx of latest.data.transactions){assert.ok(await store.get("requests",tx.id));assert.ok(!Object.hasOwn(tx,"justification"));}
 const detail=await get("/explorer/transactions/"+sample);assert.equal(detail.status,200);assert.ok(!Object.hasOwn(detail.data.transaction,"request"));
 assert.ok(!Object.hasOwn(detail.data.transaction,"justification"));assert.equal(detail.data.reasoningSource,"genlayer-finalized-contract");
 assert.deepEqual(detail.data.transaction.review,journal.cases[0].terminal.review);
 const config=await evm.read(card.address,"config") as any;
 const cpuAbi=parseAbi(["function netlist(uint256 circuitId) view returns (bytes)","function circuitInfo(uint256 circuitId) view returns (uint32,uint32,uint32,uint32)","function eval(uint256 circuitId,bytes inputs) view returns (bytes)"]);
 const [netlist,info,implementation,processorCode,beaconCode]=await Promise.all([
 evm.public.readContract({address:config.processor as Address,abi:cpuAbi,functionName:"netlist",args:[config.circuitId]}),
 evm.public.readContract({address:config.processor as Address,abi:cpuAbi,functionName:"circuitInfo",args:[config.circuitId]}),
 evm.public.readContract({address:config.beacon as Address,abi:parseAbi(["function implementation() view returns (address)"]),functionName:"implementation"}),
 evm.public.getCode({address:config.processor as Address}),evm.public.getCode({address:config.beacon as Address})]);
 const bytes=Buffer.from(hexToBytes(netlist)),local=await readFile("circuits/artifacts/policy.netlist.bin");
 assert.deepEqual(bytes,local);assert.equal("0x"+createHash("sha256").update(bytes).digest("hex"),config.expectedNetlistHash);assert.deepEqual(info,[451,8,0,1766]);
 assert.equal(implementation.toLowerCase(),config.expectedImplementation.toLowerCase());assert.equal(keccak256(processorCode!),deployment.codeHashes.processor);assert.equal(keccak256(beaconCode!),deployment.codeHashes.beacon);
 const normal={amount:1000000n,perPaymentLimit:3000000n,remainingTotal:10000000n,remainingPeriod:4000000n,validFrom:100n,now:200n,validUntil:300n,recipientAllowed:true,assetAllowed:true,enabled:true};
 const cases:[string,Record<string,unknown>,number][]=[["allow",{},1],["per_payment",{amount:3000001n},2],["total",{remainingTotal:999999n},4],["period",{remainingPeriod:999999n},8],["too_early",{now:99n},16],["expired",{now:300n},16],["recipient",{recipientAllowed:false},32],["asset",{assetAllowed:false},64],["disabled",{enabled:false},128],["multiple",{amount:4000000n,remainingTotal:2000000n,remainingPeriod:1000000n},14],["uint64_max",{amount:MAX_U64,perPaymentLimit:MAX_U64,remainingTotal:MAX_U64,remainingPeriod:MAX_U64,validFrom:0n,now:1n,validUntil:MAX_U64},1]];
 const vectors=[];
 for(const [name,changes,expected]of cases){
  const inputs=packInputs({...normal,...changes}),localBits=simulate(bytes,inputs);assert.equal(localBits,expected);
  const output=await evm.public.readContract({address:config.processor as Address,abi:cpuAbi,functionName:"eval",args:[config.circuitId,("0x"+inputs.toString("hex")) as Hex]});
  assert.equal(Number(BigInt(output)),expected);vectors.push({name,expected,actual:Number(BigInt(output)),inputs:"0x"+inputs.toString("hex"),output});
 }
 const result={mode:"REAL_HOSTED_READ_ONLY_ISOLATION_AND_TAPEOUT_AUDIT",verifiedAt:new Date().toISOString(),cardId:card._id,paymentPostCount:0,isolation:{anonymousPrivateRead:401,agentOwnerRead:401,crossCardPrivateRead:404,actualLatestRecords:latest.data.transactions.map((t:any)=>t.id),publicReasoningSource:detail.data.reasoningSource},tapeout:{processor:config.processor,beacon:config.beacon,implementation,netlistHash:config.expectedNetlistHash,netlistBytes:bytes.length,circuitInfo:info,codeHashes:{processor:keccak256(processorCode!),beacon:keccak256(beaconCode!)},adapter:"Unchanged TapeOut NetlistVM on X Layer testnet; not official TapeOut registry",vectors},rawGetLogs:logs};
 await writeFile("docs/audits/audit-12-supplementary.json",JSON.stringify(result,null,2)+"\n");
 console.log("AUDIT_ISOLATION_AND_TAPEOUT_VERIFIED");process.exit(0);
}catch{console.error("AUDIT_SUPPLEMENTARY_CHECK_FAILED");process.exit(1);}
