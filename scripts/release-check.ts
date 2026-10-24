import {readFile,access} from "node:fs/promises";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {configuration,publicConfiguration} from "../apps/web/lib/config";
import {IntentGuard} from "../packages/sdk";
import {policySchema,paymentSchema,parseAmount,TOKEN} from "../packages/shared";
import {input,policy} from "../tests/fixtures";
const read=(p:string)=>readFile(new URL("../"+p,import.meta.url),"utf8");
const openapi=JSON.parse(await read("docs/openapi.json"));
assert.equal(openapi.openapi,"3.1.0");assert.equal(openapi.servers[0].url,"/api/v1");
const operations=new Set<string>();
for(const [path,verbs]of Object.entries(openapi.paths) as [string,Record<string,any>][])for(const [method,op]of Object.entries(verbs)){assert.ok(["get","post","delete"].includes(method));assert.ok(op.operationId&&!operations.has(op.operationId));operations.add(op.operationId);assert.ok(op.responses);if(path.startsWith("/owner/"))assert.ok(op.security.some((s:any)=>"OwnerSession"in s));if(path==="/requests"&&method==="post"){assert.ok(op.security.some((s:any)=>"AgentKey"in s));assert.ok(op.parameters.some((p:any)=>p.name==="Idempotency-Key"&&p.required))}}
function checkRefs(v:any){if(v&&typeof v==="object"){if(v.$ref){const name=v.$ref.replace("#/components/schemas/","");assert.ok(openapi.components.schemas[name],"Dangling schema reference")}for(const value of Object.values(v))checkRefs(value)}}checkRefs(openapi);
assert.equal(operations.size,16);
const meta=JSON.parse(await read("circuits/artifacts/policy.metadata.json")),raw=await readFile(new URL("../circuits/artifacts/policy.netlist.bin",import.meta.url));
assert.equal(meta.sha256,"0x"+createHash("sha256").update(raw).digest("hex"));assert.equal(meta.bytes,raw.length);assert.equal(meta.gateCount*7,raw.length);assert.deepEqual(meta.inputs.slice(0,7).map((v:any)=>v.name),["amount","perPaymentLimit","remainingTotal","remainingPeriod","validFrom","now","validUntil"]);
const abi=JSON.parse(await read("contracts/evm/abi.json"));assert.equal(abi.configTuple.components.length,17);assert.equal(abi.AgentSpendingCard.find((v:any)=>v.name==="reserve").inputs[5].type,"uint64");assert.equal(abi.release.fields.length,7);
const env=await read(".env.example");for(const key of ["SESSION_SECRET","XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY","GENLAYER_OPERATOR_PRIVATE_KEY","DEPLOYER_PRIVATE_KEY","DEMO_MERCHANT_ADMIN_KEY"]){assert.ok(new RegExp("^"+key+"=$","m").test(env),"Example secrets must be empty: "+key)}
const cfg=configuration();if(!cfg.local&&!cfg.testnet){assert.equal(cfg.chainId,196);assert.equal(cfg.token,TOKEN)}if(!process.env.CARD_FACTORY_ADDRESS)assert.equal(publicConfiguration().configured,false);
assert.ok(policySchema.safeParse(policy).success);assert.ok(paymentSchema.safeParse(input).success);assert.equal(parseAmount(input.amount),5000001n);
const original=globalThis.fetch;let received:RequestInit|undefined;globalThis.fetch=async(url,init)=>{assert.equal(url,"https://intentguard.example/api/v1/requests");received=init;return Response.json({id:"test-request",status:"QUEUED"},{status:202})};
try{const result=await new IntentGuard("https://intentguard.example/","ig_test_only").request(input,"stable-idempotency");assert.equal(result.id,"test-request");const headers=received!.headers as Record<string,string>;assert.equal(headers.Authorization,"Bearer ig_test_only");assert.equal(headers["Idempotency-Key"],"stable-idempotency");assert.deepEqual(JSON.parse(String(received!.body)),input)}finally{globalThis.fetch=original}
for(const path of ["README.md","docs/CONTRACT.md","docs/ARCHITECTURE.md","docs/DEPLOYMENT.md","docs/DEMO.md","scripts/deploy.ts","scripts/merchant.ts","apps/web/vercel.json","Dockerfile"]){await access(new URL("../"+path,import.meta.url))}
const deploy=await read("scripts/deploy.ts");assert.ok(deploy.includes('process.argv.includes("--broadcast")'));assert.ok(deploy.includes('prepared.gas*125n'));assert.ok(deploy.includes('genLayerAddress(gl.account().address)'));
assert.ok((await read("docs/ARCHITECTURE.md")).includes("X Layer contract verifies its signature, not GenLayer consensus"));
console.log("RELEASE_ARTIFACTS_AND_SDK_PASSED");
