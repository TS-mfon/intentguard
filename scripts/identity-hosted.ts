import assert from "node:assert/strict";
import {chromium,type Page,type APIResponse} from "@playwright/test";
import {loadEnvFile} from "node:process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {hexToString,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {parseAmount,formatAmount} from "../packages/shared";
import {docsSections} from "../apps/web/app/docs/sections";

for(const file of [".local/testnet-secrets.env",".local/hosting.env",".local/audit-agent.env"])loadEnvFile(file);
assert.equal(process.env.INTENTGUARD_MODE,"testnet");assert.equal(process.env.XLAYER_CHAIN_ID,"1952");
const base=process.env.APP_URL!.replace(/\/$/,""),old="https://intentguard-gen-daves-projects.vercel.app";
assert.equal(base,"https://intentguard-tapeout.vercel.app");
const account=privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex);
const key=process.env.INTENTGUARD_AUDIT_API_KEY!;assert.ok(key);
const agentId="0x5265d227519c96e186cda7e45d072d18751dca8da58615ca8832bd78527faf37";
const folder=".local/identity-hosted";await mkdir(folder,{recursive:true});
const logs:unknown[]=[],errors:string[]=[],origins:unknown[]=[];
async function request(origin:string,path:string,init:RequestInit={}){
 const response=await fetch(origin+"/api/v1"+path,{...init,redirect:"error",signal:AbortSignal.timeout(45000)});
 const body=await response.text();assert.ok(!body.includes(key),"Response exposed credential");
 const headers=Object.fromEntries(response.headers.entries());delete headers["set-cookie"];
 logs.push({request:{url:origin+"/api/v1"+path,method:init.method||"GET",headers:Object.fromEntries([...new Headers(init.headers)].map(([k,v])=>[k,/authorization|cookie/.test(k)?"[REDACTED]":v])),body:init.body??null},response:{status:response.status,headers,body}});
 return {response,body,json:()=>JSON.parse(body)};
}
async function get(path:string){const result=await request(base,path);assert.equal(result.response.status,200,path);return result.json();}
const config=await get("/config");assert.equal(config.configured,true);assert.equal(config.chainId,1952);assert.equal(config.mode,"testnet");
const latest=(await get("/explorer/transactions?limit=3")).transactions;assert.equal(latest.length,3);
const all:any[]=[];let cursor:string|null=null;
do{const page=await get("/explorer/transactions?agentId="+agentId+"&limit=50"+(cursor?"&cursor="+encodeURIComponent(cursor):""));all.push(...page.transactions);cursor=page.nextCursor;}while(cursor);
assert.ok(all.length>0);assert.equal(new Set(all.map(p=>p.id)).size,all.length);
const card=await get("/explorer/agents/"+agentId+"/card"),sum=all.filter(p=>p.status==="PAID").reduce((n,p)=>n+parseAmount(p.amount),0n);
assert.equal(card.usage.requestCount,all.length);assert.equal(card.usage.paidCount,all.filter(p=>p.status==="PAID").length);
assert.equal(card.usage.fundsMoved,formatAmount(sum));assert.equal(card.usage.blockedCount,all.filter(p=>p.status==="BLOCKED").length);
const cardShareUrl=new URL(card.shareUrl);assert.equal(cardShareUrl.origin,base);assert.equal(cardShareUrl.pathname,"/explorer");assert.equal(cardShareUrl.searchParams.get("agentId"),agentId);assert.equal(cardShareUrl.searchParams.get("view"),"agents");
const svg=await request(base,"/explorer/agents/"+agentId+"/card.svg");
assert.equal(svg.response.status,200);assert.match(svg.response.headers.get("Content-Type")||"",/image\/svg\+xml/);
assert.match(svg.response.headers.get("Content-Disposition")||"",/attachment/);assert.ok(svg.body.includes(card.usage.fundsMoved));
await writeFile(folder+"/actual-agent-card.svg",svg.body);
const me=await request(base,"/me",{headers:{Authorization:"Bearer "+key}});
assert.equal(me.response.status,200);assert.equal(me.json().card.id,agentId);
for(const header of ["ratelimit-limit","ratelimit-remaining","ratelimit-reset","ratelimit-policy","x-request-id"])assert.ok(me.response.headers.has(header),header);
const errorCases:{path:string;method?:string;headers?:Record<string,string>;body?:string;status:number;code:string}[]=[
 {path:"/config",method:"PUT",headers:{"Content-Type":"application/json"},body:"{}",status:405,code:"METHOD_NOT_ALLOWED"},
 {path:"/not-an-endpoint",status:404,code:"NOT_FOUND"},
 {path:"/auth/challenge",method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:"{",status:400,code:"INVALID_JSON"},
 {path:"/auth/challenge",method:"POST",headers:{Origin:base,"Content-Type":"text/plain"},body:"{}",status:415,code:"UNSUPPORTED_MEDIA_TYPE"},
 {path:"/auth/challenge",method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:"{}",status:422,code:"INVALID_INPUT"},
 {path:"/auth/challenge",method:"POST",headers:{Origin:"https://unapproved.example","Content-Type":"application/json"},body:JSON.stringify({address:account.address}),status:403,code:"ORIGIN_DENIED"},
 {path:"/requests",method:"POST",headers:{"Content-Type":"application/json"},body:"{}",status:401,code:"KEY_REQUIRED"}
];
for(const c of errorCases){
 const r=await request(base,c.path,{method:c.method||"GET",headers:c.headers,body:c.body});
 assert.equal(r.response.status,c.status,c.path);const e=r.json().error;assert.equal(e.code,c.code);assert.equal(typeof e.retryable,"boolean");
 assert.equal(r.response.headers.get("X-Request-Id"),e.requestId);assert.equal(r.response.headers.get("Cache-Control"),"no-store");
 if(c.status===405)assert.equal(r.response.headers.get("Allow"),"GET");
}
const browser=await chromium.launch({headless:true});
async function fits(page:Page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Overflow at "+page.url());}
try{
 for(const origin of [base,old]){
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));let signatures=0;await page.exposeBinding("intentguardReleaseWallet",async(source,args:{method:string;params?:unknown[]})=>{
  assert.equal(new URL(source.page.url()).origin,origin);
  if(["eth_accounts","eth_requestAccounts"].includes(args.method))return [account.address];
  if(args.method==="eth_chainId")return "0x7a0";
  if(args.method==="personal_sign"){
   const [raw,address]=args.params??[];assert.equal(String(address).toLowerCase(),account.address.toLowerCase());
   const message=hexToString(String(raw) as Hex),lines=message.split("\n");
   assert.equal(lines[0],"IntentGuard owner login");assert.equal(lines[1],new URL(origin).host);
   assert.equal(lines[2],account.address.toLowerCase());assert.equal(lines[3],"Chain ID: 1952");
   assert.match(lines[4],/^Nonce: [a-f0-9]{48}$/);assert.equal(lines[6],"This signature authorizes a dashboard session only.");
   assert.ok(Date.parse(lines[5].replace("Expires: ",""))>Date.now());signatures++;return account.signMessage({message});
  }
  throw Error("Release verification allows domain-bound login signatures only");
 });
 await context.addInitScript({content:'window.intentguardReleaseListeners={};Object.defineProperty(window,"ethereum",{value:{request:async args=>{const result=await window.intentguardReleaseWallet(args);if(args.method==="eth_requestAccounts")window.intentguardReleaseListeners.accountsChanged?.(result);return result},on:(event,handler)=>window.intentguardReleaseListeners[event]=handler,removeListener:event=>delete window.intentguardReleaseListeners[event]}})'});
 const response=await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});assert.equal(response?.status(),200);
 await page.locator(".hero-title").waitFor({timeout:45000});
 await page.locator(".transaction-row").first().waitFor({timeout:45000});
 assert.equal(await page.locator(".transaction-row").count(),3);
 assert.equal(await page.getByText(/Browser fixture|SAMPLE PREVIEW|Sample balances/).count(),0);
 if(origin===base){
  for(const tx of latest)assert.equal(await page.locator('a[href="/explorer/transactions/'+tx.id+'"]').count(),1);
  const iconHref=await page.locator('link[rel="icon"]').first().getAttribute("href");assert.ok(iconHref);
  const icon:APIResponse=await context.request.get(new URL(iconHref,origin).href);assert.equal(icon.status(),200);assert.ok((await icon.text()).includes("<svg"));
  const video:APIResponse=await context.request.get(origin+"/motion/agent-card.mp4");assert.equal(video.status(),200);assert.ok((await video.body()).length<1048576);
  assert.match(video.headers()["content-type"],/video\/mp4/);
  for(const width of [320,390,768,1440,1920]){await page.setViewportSize({width,height:1000});await fits(page);await page.screenshot({path:folder+"/landing-"+width+".png",fullPage:true,animations:"disabled"});}
  await page.setViewportSize({width:1440,height:1000});
 }
 await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();
 await page.getByRole("button",{name:"Sign out",exact:true}).waitFor({timeout:45000});
 assert.equal(signatures,1);
 await page.evaluate(owner=>(window as unknown as {intentguardReleaseListeners:Record<string,(a:string[])=>void>}).intentguardReleaseListeners.accountsChanged([owner]),account.address);
 await page.waitForTimeout(100);assert.equal(await page.getByText(/Wallet account changed|Sign in again to access/).count(),0);
 const stillAuthenticated=await page.evaluate(async()=>{const r=await fetch("/api/v1/auth/session");const body=await r.json();return {status:r.status,address:body.address??null,errorCode:body.error?.code}});assert.equal(stillAuthenticated.status,200);assert.equal(stillAuthenticated.address?.toLowerCase(),account.address.toLowerCase());

 const ownedResponse:APIResponse=await context.request.get(origin+"/api/v1/owner/cards");assert.equal(ownedResponse.status(),200);
 const owned:{id:string}[]=(await ownedResponse.json()).cards;
 assert.ok(Array.isArray(owned));for(const own of owned){const snapshot=await get("/explorer/agents/"+own.id+"/card");assert.equal(snapshot.agent.owner.toLowerCase(),account.address.toLowerCase(),"Owner list must isolate the authenticated wallet")}
 await page.goto(origin+"/agents");await page.getByRole("heading",{name:"My agents",exact:true}).waitFor({timeout:45000});
 if(card.agent.owner.toLowerCase()!==account.address.toLowerCase())assert.equal(await page.locator('.issued-identity').filter({hasText:card.agent.name}).count(),0,"Audit agent belongs to its actual human, not the operator");
 if(origin===base){
  await page.screenshot({path:folder+"/owner-agents.png",fullPage:true,animations:"disabled"});
  await page.goto(origin+"/explorer?agentId="+agentId);
  await page.locator(".selected-agent-identity .atm-card").waitFor({timeout:45000});
  assert.ok((await page.locator(".selected-agent-identity .atm-usage").innerText()).includes(card.usage.requestCount.toLocaleString()));
  assert.ok((await page.locator(".selected-agent-identity .atm-usage").innerText()).includes(card.usage.fundsMoved));
  await page.screenshot({path:folder+"/public-agent.png",fullPage:true,animations:"disabled"});
  const svgDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Download card",exact:true}).click();await (await svgDownload).saveAs(folder+"/downloaded-card.svg");
  const pngDownload=page.waitForEvent("download");await page.getByRole("button",{name:"PNG",exact:true}).click();await (await pngDownload).saveAs(folder+"/downloaded-card.png");
  const png=await readFile(folder+"/downloaded-card.png");assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),760);assert.ok(png.length>10000);
  const share=await page.getByRole("link",{name:"Share on X"}).getAttribute("href");assert.ok(share);
  const shareUrl=new URL(share);assert.equal(shareUrl.searchParams.get("url"),card.shareUrl);
  assert.ok(shareUrl.searchParams.get("text")?.includes(card.usage.fundsMoved));
  for(const [,slug]of docsSections){
   const r=await page.goto(origin+"/docs/"+slug,{timeout:60000});assert.equal(r?.status(),200,slug);
   assert.equal(await page.locator(".docs-article > section").count(),1,slug);await fits(page);
  }
  for(const status of ["BLOCKED","NEEDS_EVIDENCE","CANCELLED","PAID"]){
   const tx=all.find(p=>p.status===status);assert.ok(tx,"Expected actual "+status+" record");
   const d=await get("/explorer/transactions/"+tx.id);
   await page.goto(origin+"/explorer/transactions/"+tx.id);
   await page.locator(".decision-stage").first().waitFor({timeout:45000});
   const review=page.locator(".decision-stage").filter({has:page.getByRole("heading",{name:"Evidence review"})});
   await review.locator(".section-heading > .status").waitFor();
   if(status==="BLOCKED"){assert.equal(d.reviewStage.status,"SKIPPED");assert.ok((await review.innerText()).includes("Skipped"));assert.ok(!(await review.innerText()).includes("Pending"));await page.screenshot({path:folder+"/blocked-review.png",fullPage:true,animations:"disabled"});}
   if(status==="PAID"){assert.equal(d.reasoningSource,"genlayer-finalized-contract");assert.equal(d.reviewStage.status,"COMPLETE");assert.ok((await review.innerText()).includes(d.transaction.review.reason));}
   assert.notEqual(d.reviewStage.status,"PENDING");await fits(page);
  }
  await page.goto(origin+"/explorer?agentId="+agentId);await page.locator(".selected-agent-identity .atm-card").waitFor({timeout:45000});await fits(page);
  await page.screenshot({path:folder+"/explorer.png",fullPage:true,animations:"disabled"});
  await page.goto(origin+"/agent-setup");await page.getByRole("heading",{name:"Create an agent"}).waitFor();await fits(page);
 }
 origins.push({origin,loginSignatures:signatures,privateOwnerIsolationVerified:true,ownedAgentCount:owned.length,ownerOwnsAuditAgent:card.agent.owner.toLowerCase()===account.address.toLowerCase(),publicAuditCardVerified:origin===base});await context.close();
 }
 const reduced=await browser.newContext({reducedMotion:"reduce",viewport:{width:390,height:844}});
 const page=await reduced.newPage();await page.goto(base);await page.locator(".hero-title").waitFor();
 await page.waitForTimeout(1000);assert.equal(await page.locator("video").evaluate((v:HTMLVideoElement)=>v.paused),true);await fits(page);await reduced.close();
 assert.deepEqual(errors,[]);
 const report={mode:"LIVE_HOSTED_IDENTITY_RELEASE_NO_PAYMENT_POSTS",verifiedAt:new Date().toISOString(),base,origins,actualLatestIds:latest.map((p:any)=>p.id),agentId,usage:card.usage,independentRequestCount:all.length,independentFundsMoved:formatAmount(sum),docsSectionCount:docsSections.length,viewports:[320,390,768,1440,1920],png:{width:1200,height:760},errorCodes:errorCases.map(c=>({status:c.status,code:c.code})),paymentAdmissions:0,pageErrors:errors,rawApiLogs:logs};
 await writeFile(folder+"/report.json",JSON.stringify(report,null,2)+"\n");console.log("HOSTED_IDENTITY_RELEASE_VERIFIED",JSON.stringify({requests:all.length,fundsMoved:formatAmount(sum),docsSections:docsSections.length,origins:origins.length}));
}finally{await browser.close();}
