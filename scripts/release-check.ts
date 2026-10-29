import {readFile,access} from "node:fs/promises";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {configuration,publicConfiguration} from "../apps/web/lib/config";
import {IntentGuard} from "../packages/sdk";
import {policySchema,paymentSchema,parseAmount,TOKEN} from "../packages/shared";
import {input,policy,card,FakeEvm} from "../tests/fixtures";
import {digest} from "../packages/shared";
import {CCTP_TESTNETS,TESTNET_ASSETS} from "../packages/shared/assets";
const read=(p:string)=>readFile(new URL("../"+p,import.meta.url),"utf8");
const openapi=JSON.parse(await read("docs/openapi.json"));
assert.equal(openapi.openapi,"3.1.0");assert.equal(openapi.servers[0].url,"/api/v1");
const operations=new Set<string>();
for(const [path,verbs]of Object.entries(openapi.paths) as [string,Record<string,any>][])for(const [method,op]of Object.entries(verbs)){assert.ok(["get","post","delete"].includes(method));assert.ok(op.operationId&&!operations.has(op.operationId));operations.add(op.operationId);assert.ok(op.responses);if(path.startsWith("/owner/"))assert.ok(op.security.some((s:any)=>"OwnerSession"in s));if(path==="/requests"&&method==="post"){assert.ok(op.security.some((s:any)=>"AgentKey"in s));assert.ok(op.parameters.some((p:any)=>p.name==="Idempotency-Key"&&p.required))}}
function checkRefs(v:any){if(v&&typeof v==="object"){if(v.$ref){assert.ok(v.$ref.startsWith("#/"),"External OpenAPI reference");let target:any=openapi;for(const part of v.$ref.slice(2).split("/"))target=target?.[part.replace(/~1/g,"/").replace(/~0/g,"~")];assert.ok(target,"Dangling OpenAPI reference: "+v.$ref)}for(const value of Object.values(v))checkRefs(value)}}checkRefs(openapi);
assert.ok(operations.has("retryReviewer"));assert.ok(openapi.paths["/owner/cards/{id}/reviewer"].post.responses["202"]);
const meta=JSON.parse(await read("circuits/artifacts/policy.metadata.json")),raw=await readFile(new URL("../circuits/artifacts/policy.netlist.bin",import.meta.url));
assert.equal(meta.sha256,"0x"+createHash("sha256").update(raw).digest("hex"));assert.equal(meta.bytes,raw.length);assert.equal(meta.gateCount*7,raw.length);assert.deepEqual(meta.inputs.slice(0,7).map((v:any)=>v.name),["amount","perPaymentLimit","remainingTotal","remainingPeriod","validFrom","now","validUntil"]);
const abi=JSON.parse(await read("contracts/evm/abi.json"));assert.equal(abi.configTuple.components.length,17);assert.equal(abi.AgentSpendingCard.find((v:any)=>v.name==="reserve").inputs[5].type,"uint64");assert.equal(abi.release.fields.length,7);
const env=await read(".env.example");for(const key of ["SESSION_SECRET","XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY","GENLAYER_OPERATOR_PRIVATE_KEY","DEPLOYER_PRIVATE_KEY","DEMO_MERCHANT_ADMIN_KEY"]){assert.ok(new RegExp("^"+key+"=$","m").test(env),"Example secrets must be empty: "+key)}
const cfg=configuration();if(!cfg.local&&!cfg.testnet){assert.equal(cfg.chainId,196);assert.equal(cfg.token,TOKEN)}if(!process.env.CARD_FACTORY_ADDRESS)assert.equal(publicConfiguration().configured,false);
assert.ok(policySchema.safeParse(policy).success);assert.ok(paymentSchema.safeParse(input).success);assert.equal(parseAmount(input.amount),5000001n);
const sdkOrigin="https://intentguard.example",testToken="0x47f846c659b4df565d2e8b1cd32f610e68d11b9a",testKey="ig_"+"a".repeat(43);
const sdkConfig={mode:"testnet",paymentEnvironment:"testnet",chainId:1952,reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,reviewInfrastructure:"studionet-simulator",apiOrigin:sdkOrigin,frontendOrigin:sdkOrigin,applicationUrl:sdkOrigin,ownerSessionTransport:"cookie",releaseId:null,sourceCommit:null,configured:true,settlementVersion:1,readinessReasons:[],token:testToken,assets:TESTNET_ASSETS,spendingNetworks:Object.values(CCTP_TESTNETS)};
const sdkCard={...await new FakeEvm().view(card),chainId:1952,token:testToken,paymentEnvironment:"testnet",reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,policyHash:digest(policy)};
const calls:{path:string;init:RequestInit}[]=[];
const fetchImpl:typeof fetch=async(url,init={})=>{const endpoint=new URL(String(url));assert.equal(endpoint.origin,sdkOrigin);const path=endpoint.pathname;calls.push({path,init});if(path==="/api/v1/config")return Response.json(sdkConfig);if(path==="/api/v1/me")return Response.json({card:sdkCard});assert.equal(path,"/api/v1/requests");return Response.json({id:card._id,status:"QUEUED"},{status:202})};
const result=await new IntentGuard({baseUrl:sdkOrigin,paymentEnvironment:"testnet",apiKey:testKey,expectedCardId:card._id,fetchImpl}).request(input,"stable-idempotency");assert.equal(result.id,card._id);assert.deepEqual(calls.map(c=>c.path),["/api/v1/config","/api/v1/me","/api/v1/requests"]);assert.equal(new Headers(calls[0].init.headers).get("Authorization"),null);const requestHeaders=new Headers(calls[2].init.headers);assert.equal(requestHeaders.get("Authorization"),"Bearer "+testKey);assert.equal(requestHeaders.get("X-IntentGuard-Environment"),"testnet");assert.equal(requestHeaders.get("Idempotency-Key"),"stable-idempotency");assert.deepEqual(JSON.parse(String(calls[2].init.body)),input);
for(const path of ["README.md","docs/CONTRACT.md","docs/ARCHITECTURE.md","docs/DEPLOYMENT.md","docs/DEMO.md","scripts/deploy.ts","scripts/merchant.ts","apps/web/vercel.json","Dockerfile"]){await access(new URL("../"+path,import.meta.url))}
const deploy=await read("scripts/deploy.ts");assert.ok(deploy.includes('process.argv.includes("--broadcast")'));assert.ok(deploy.includes('prepared.gas*125n'));assert.ok(deploy.includes('genLayerAddress(gl.account().address)'));
assert.ok((await read("docs/ARCHITECTURE.md")).includes("X Layer contract verifies its signature, not GenLayer consensus"));
console.log("RELEASE_ARTIFACTS_AND_SDK_PASSED");
