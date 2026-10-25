import assert from "node:assert/strict";
import {readFile,access} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {docsSections} from "../apps/web/app/docs/sections";
import {paymentSchema,parseAmount} from "../packages/shared";
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
assert.equal(docsSections.length,21);assert.equal(new Set(docsSections.map(([,id])=>id)).size,21);
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
console.log("Protocol documentation verification passed");
