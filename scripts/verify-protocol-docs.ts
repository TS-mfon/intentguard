import assert from "node:assert/strict";
import {readFile,access} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {docsSections} from "../apps/web/app/docs/sections";
import {paymentSchema,parseAmount,settlementSchema} from "../packages/shared";
import {CCTP_TESTNETS,TESTNET_ASSETS} from "../packages/shared/assets";
const root=new URL("../",import.meta.url),text=async(path:string)=>readFile(new URL(path,root),"utf8");
const openapi=JSON.parse(await text("docs/openapi.json"));
assert.equal(openapi.openapi,"3.1.0");assert.equal(openapi.servers[0].url,"/api/v1");
assert.equal(openapi.servers[1].url,"https://intentguard-tapeout.vercel.app/api/v1");
const operations=new Set<string>();
const expected={"/config":["get"],"/auth/challenge":["post"],"/auth/login":["post"],"/auth/session":["get"],"/auth/logout":["post"],"/owner/drafts":["post"],"/owner/drafts/{id}":["get"],"/owner/cards":["get","post"],"/owner/cards/{id}/keys":["post","delete"],"/owner/cards/{id}/reviewer":["post"],"/owner/requests":["get"],"/owner/requests/{id}":["get"],"/me":["get"],"/requests":["post"],"/requests/{id}":["get"],"/explorer/agents":["get"],"/explorer/transactions":["get"],"/explorer/transactions/{id}":["get"],"/explorer/agents/{id}/card":["get"],"/explorer/agents/{id}/card.svg":["get"],"/demo/invoices":["post"],"/demo/invoices/{id}":["get"]};
assert.deepEqual(Object.keys(openapi.paths).sort(),Object.keys(expected).sort());
for(const[path,methods]of Object.entries(expected)){
 assert.deepEqual(Object.keys(openapi.paths[path]).sort(),methods.sort());
 for(const method of methods){
  const op=openapi.paths[path][method];assert.ok(op.operationId&&!operations.has(op.operationId));operations.add(op.operationId);
  assert.ok(op.responses["405"]);assert.ok(op.responses.default);
  if(path.startsWith("/owner/"))assert.ok(op.security.some((s:Record<string,unknown>)=>"OwnerSession"in s));
 }
}
function refs(value:any){if(value&&typeof value==="object"){if(value.$ref){const name=value.$ref.replace("#/components/schemas/","");assert.ok(openapi.components.schemas[name],"Dangling schema "+name)}for(const child of Object.values(value))refs(child)}}refs(openapi);
assert.deepEqual(openapi.components.schemas.ReviewStage.properties.status.enum,["PENDING","COMPLETE","SKIPPED","FAILED"]);
assert.deepEqual(openapi.components.schemas.Error.properties.error.required,["code","message","retryable","requestId"]);
assert.ok(openapi.paths["/requests"].post.parameters.some((p:any)=>p.name==="Idempotency-Key"&&p.required));
const valid={recipient:"0x"+"11".repeat(20),amount:"1.000001",purchaseDescription:"Approved research data",justification:"Supports the approved mission",category:"data",invoiceId:"invoice-1",evidence:[{url:"https://merchant.example/invoice.json"}]};
assert.equal(paymentSchema.safeParse(valid).success,true);for(const amount of ["1e3","1.0000001","0","-1","01"]){assert.equal(paymentSchema.safeParse({...valid,amount}).success,false);}
assert.equal(parseAmount("18446744073709.551615"),(1n<<64n)-1n);
assert.equal(docsSections.length,22);assert.equal(new Set(docsSections.map(([,id])=>id)).size,22);
assert.ok(docsSections.some(([,id])=>id==="crosschain"));
await access(new URL("apps/web/app/docs/[section]/page.tsx",root));
const component=await text("apps/web/components/docs.tsx");for(const[,id]of docsSections)assert.ok(component.includes('"'+id+'":<section id="'+id+'"'),"Missing section "+id);
assert.ok(component.includes("{content[section]}"));assert.ok(!component.includes('href={"#"+id}'),"TOC must navigate section routes");
const manual=await text("docs/PROTOCOL.md");
assert.equal(await text("packages/mcp/resources/PROTOCOL.md"),manual);assert.equal(await text("skills/intentguard/references/PROTOCOL.md"),manual);
assert.deepEqual(JSON.parse(await text("packages/mcp/resources/openapi.json")),openapi);
const readme=await text("README.md");
for(const file of ["README.md","docs/PROTOCOL.md","skills/intentguard/SKILL.md"]){
 const content=await text(file);for(const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const target=match[1];if(/^(https?:|#|mailto:)/.test(target))continue;
  const relative=file.slice(0,file.lastIndexOf("/")+1)+target.split("#")[0];await access(new URL(relative,root));
 }
}
assert.ok((readme.match(/\x60\x60\x60mermaid/g)||[]).length>=4);
const skill=await text("skills/intentguard/SKILL.md");
const frontmatter=skill.match(/^---\n([\s\S]*?)\n---/);assert.ok(frontmatter,"Skill must have YAML frontmatter");assert.match(frontmatter[1],/^name: intentguard$/m);assert.match(frontmatter[1],/^description: .{10,1024}$/m);assert.ok(!skill.includes("[TODO:"));
if(process.env.INTENTGUARD_SKILL_VALIDATOR){const result=spawnSync("python3",[process.env.INTENTGUARD_SKILL_VALIDATOR,"skills/intentguard"],{cwd:root,encoding:"utf8"});assert.equal(result.status,0,result.stdout+result.stderr);}

assert.equal(openapi.info.version,"0.3.0");
const lifecycle=["BRIDGING","AWAITING_ATTESTATION","MINTING"];
for(const name of ["RequestView","PublicTransaction"]){
 for(const status of lifecycle)assert.ok(openapi.components.schemas[name].properties.status.enum.includes(status),"Missing bridge lifecycle "+name+"/"+status);
 assert.equal(openapi.components.schemas[name].properties.bridge.$ref,"#/components/schemas/BridgeView");
 assert.ok(openapi.components.schemas[name].properties.paymentSymbol);
}
assert.deepEqual(openapi.components.schemas.BridgeView.properties.phase.enum,["BURNED","ATTESTATION_PENDING","ATTESTED","MINT_SUBMITTED","CONFIRMED"]);
assert.deepEqual(openapi.components.schemas.Settlement.properties.destinationChainIds.items.enum,Object.keys(CCTP_TESTNETS).map(Number).sort((a,b)=>a-b));
assert.equal(openapi.components.schemas.Settlement.properties.asset.const,"USDC");
assert.equal(openapi.components.schemas.PaymentInput.properties.destinationChainId.type,"integer");
assert.ok(!openapi.components.schemas.PaymentInput.required.includes("destinationChainId"),"Legacy payment inputs stay valid");
for(const field of ["assets","spendingNetworks","cctpFactoryAddress"])assert.ok(openapi.components.schemas.Config.properties[field]);
for(const name of ["CardView","DraftView","PublicAgent"])assert.equal(openapi.components.schemas[name].properties.settlement.$ref,"#/components/schemas/Settlement");
const draftSchema=openapi.paths["/owner/drafts"].post.requestBody.content["application/json"].schema;
assert.equal(draftSchema.properties.settlement.$ref,"#/components/schemas/Settlement");
const invoiceSchema=openapi.paths["/demo/invoices"].post.requestBody.content["application/json"].schema;
for(const field of ["chainId","token"])assert.ok(invoiceSchema.properties[field]&&!invoiceSchema.required.includes(field));
assert.equal(TESTNET_ASSETS.find(a=>a.asset==="USDT0")?.available,false);
const supported={asset:"USDC",destinationChainIds:[421614,1952,84532]};
assert.deepEqual(settlementSchema.parse(supported).destinationChainIds,[1952,84532,421614]);
for(const invalid of [{...supported,asset:"USDT0"},{...supported,destinationChainIds:[196]},{...supported,destinationChainIds:[]},{...supported,destinationChainIds:[1952,1952]}])assert.equal(settlementSchema.safeParse(invalid).success,false);
assert.equal(paymentSchema.safeParse({...valid,destinationChainId:84532}).success,true);
for(const destinationChainId of [0,-1,84532.5,"84532"])assert.equal(paymentSchema.safeParse({...valid,destinationChainId}).success,false);
const crosschain=await text("docs/CROSSCHAIN.md");
for(const [,network] of Object.entries(CCTP_TESTNETS))assert.ok(crosschain.includes(network.token),network.name+" issuer deployment missing from docs");
for(const artifact of [manual,crosschain,component,skill]){
 for(const status of lifecycle)assert.ok(artifact.includes(status),"Integration artifact lacks "+status);
 assert.ok(artifact.includes("USDT0"),"Unavailable issuer asset must be explicit");
}

console.log("Protocol documentation verification passed");
