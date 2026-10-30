import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {chromium,type Page} from "@playwright/test";
import {card,policy,owner,FakeEvm} from "../tests/fixtures";
import {digest} from "../packages/shared";
import {CCTP_TESTNETS,TESTNET_ASSETS} from "../packages/shared/assets";
import {cardSvg,type AgentUsage} from "../apps/web/lib/agent-card";

// Isolated layout fixtures use the real serializer, not placeholder export art.
// This verifies rendering and controls; it is not live financial evidence.
const port=await new Promise<number>((resolve,reject)=>{
 const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{
  const address=s.address();assert.ok(address&&typeof address==="object");s.close(()=>resolve(address.port));
 });
});
await readFile(new URL("../apps/web/.next/BUILD_ID",import.meta.url),"utf8");
const base="http://localhost:"+port,folder=new URL("../.local/glossy-agent-card/",import.meta.url);
await mkdir(folder,{recursive:true});
process.env.APP_URL=base;process.env.FRONTEND_URL=base;
const server=spawn(process.execPath,[fileURLToPath(new URL("../apps/web/node_modules/next/dist/bin/next",import.meta.url)),"start","--hostname","localhost","--port",String(port)],{
 cwd:new URL("../apps/web/",import.meta.url),stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32",
 env:{PATH:process.env.PATH,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",APP_URL:base,FRONTEND_URL:base,INTENTGUARD_MODE:"local",INTENTGUARD_PAYMENT_ENV:"local",XLAYER_CHAIN_ID:"31337"}
});
let output="",browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
server.stdout.on("data",c=>output+=c.toString());server.stderr.on("data",c=>output+=c.toString());
const errors:string[]=[],checks:string[]=[],view=await new FakeEvm().view(card);
const agent={id:card._id,name:policy.name,mission:policy.mission,address:card.address,owner,policyHash:digest(policy),chainId:1952,token:String(card.token),paymentSymbol:"TEST-USDT",status:"ACTIVE",createdAt:Date.now(),financial:policy.financial,criteria:policy.criteria,balances:view.balances};
const usage:AgentUsage={requestCount:245,paidCount:123,blockedCount:122,rejectedCount:0,needsEvidenceCount:0,cancelledCount:0,activeCount:0,fundsMoved:"123.000123",token:String(card.token),chainId:1952,asOf:Date.UTC(2026,9,30,12)};
const snapshot={agent,usage,shareUrl:base+"/explorer?agentId="+agent.id};
let cardError=false,downloadError=false,delayCard=false,authenticated=false;
const config={assets:TESTNET_ASSETS,spendingNetworks:Object.values(CCTP_TESTNETS),mode:"testnet",paymentEnvironment:"testnet",reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,apiOrigin:base,frontendOrigin:base,applicationUrl:base,ownerSessionTransport:"cookie",readinessReasons:[],networkName:"X Layer Testnet",paymentSymbol:"TEST-USDT",chainId:1952,token:String(card.token),configured:true,explorerUrl:"https://www.oklink.com/xlayer-test",genLayerExplorerUrl:"https://explorer-studio.genlayer.com"};
async function fits(page:Page){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Document overflows at "+await page.viewportSize()?.width);
 const instrument=page.locator(".atm-card").first();
 assert.equal(await instrument.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,"Card content overflows");
 const collisions=await instrument.evaluate(el=>{
  const bounds=el.getBoundingClientRect();return [...el.querySelectorAll("h3,.atm-usage strong,.atm-footer,[class*='disclosure']")].filter(node=>{
   const r=node.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1||r.bottom>bounds.bottom+1;
  }).map(node=>node.textContent);
 });assert.deepEqual(collisions,[],"Critical text outside card");
}
async function capture(page:Page,name:string){await page.locator(".atm-card").first().screenshot({path:new URL(name+".png",folder).pathname});}
async function check(name:string,run:()=>Promise<void>){await run();checks.push(name);console.log("CARD_CHECK "+name);}
try{
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){if(await fetch(base).then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,300));}
 assert.ok(await fetch(base).then(r=>r.ok).catch(()=>false),"Production server failed: "+output.slice(-1500));
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
 await context.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname.replace("/api/v1","");
  assert.equal(route.request().headers().authorization,undefined,"Public/fixture requests must carry no credential");
  if(path.endsWith("/card.svg")){
   if(downloadError){await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{code:"UNAVAILABLE",message:"Card service is temporarily unavailable."}})});return;}
   await route.fulfill({contentType:"image/svg+xml",headers:{"Content-Disposition":"attachment; filename=agent.svg"},body:cardSvg(snapshot.agent,snapshot.usage,snapshot.agent.paymentSymbol)});return;
  }
  let data:unknown,status=200;
  if(path==="/config")data=config;
  else if(path==="/auth/session")data={address:authenticated?owner:null};
  else if(path==="/explorer/agents")data={agents:[snapshot.agent],nextCursor:null};
  else if(path==="/explorer/transactions")data={transactions:[],nextCursor:null};
  else if(path.endsWith("/card")){
   if(delayCard)await new Promise(r=>setTimeout(r,800));
   if(cardError){status=503;data={error:{code:"UNAVAILABLE",message:"Card service is temporarily unavailable."}};}else data=snapshot;
  }else if(path==="/owner/cards")data={cards:[{...view,...snapshot.agent,keyStatus:"NONE"}]};
  else if(path==="/owner/requests")data={requests:[]};
  else{status=404;data={error:{code:"NOT_FOUND",message:"Isolated endpoint unavailable"}};}
  await route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(12000);
 const publicPath=base+"/explorer?agentId="+agent.id;
 await check("wallet-free compact preview, genuine fixture fields and responsive layout",async()=>{
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1100});await page.goto(publicPath);await page.locator(".atm-card").waitFor();await page.evaluate(()=>document.fonts.ready);
   await fits(page);assert.match(await page.locator(".atm-usage").innerText(),/123\.000123/);assert.match(await page.locator(".atm-card").innerText(),/245/);
   await capture(page,"compact-"+width);
  }
 });
 await check("owner full preview and compact directory layout",async()=>{
  authenticated=true;
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1100});await page.goto(base+"/agents");await page.locator(".atm-card").waitFor();await fits(page);await capture(page,"full-"+width);
  }
  authenticated=false;await page.goto(publicPath+"&view=agents");await page.locator(".atm-card").waitFor();await fits(page);
 });
 await check("actual standalone SVG and PNG preserve alpha and exported exact amounts",async()=>{
  await page.goto(publicPath);await page.locator(".atm-card").waitFor();
  const svgPromise=page.waitForEvent("download");await page.getByRole("button",{name:"Download card",exact:true}).click();
  const svg=await svgPromise;await svg.saveAs(new URL("actual-card.svg",folder).pathname);
  const source=await readFile(new URL("actual-card.svg",folder),"utf8");assert.ok(source.includes(usage.fundsMoved));assert.ok(!/<(?:image|script|foreignObject)\b/i.test(source));
  const pngPromise=page.waitForEvent("download");await page.getByRole("button",{name:"PNG",exact:true}).click();
  const png=await pngPromise;await png.saveAs(new URL("actual-card.png",folder).pathname);
  const data=await readFile(new URL("actual-card.png",folder));
  const renderPage=await context.newPage();
  await renderPage.setContent('<style>body{margin:0;padding:24px;background:#101716}img{width:1200px;display:block}</style><img alt="Actual transparent card export">');
  const alpha=await renderPage.evaluate(async url=>{
   const img=document.querySelector("img")!;img.src=url;await img.decode();
   const canvas=document.createElement("canvas");canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
   const ctx=canvas.getContext("2d")!;ctx.drawImage(img,0,0);
   return{width:canvas.width,height:canvas.height,corner:ctx.getImageData(0,0,1,1).data[3],face:ctx.getImageData(100,350,1,1).data[3]};
  },"data:image/png;base64,"+data.toString("base64"));
  assert.equal(alpha.width,1200);assert.equal(alpha.height,760);assert.equal(alpha.corner,0);assert.ok(alpha.face>0&&alpha.face<255,"Face must retain real alpha");
  await renderPage.setViewportSize({width:1248,height:808});await renderPage.screenshot({path:new URL("export-dark.png",folder).pathname});
  await renderPage.evaluate(()=>document.body.style.background="#f4f2eb");await renderPage.screenshot({path:new URL("export-light.png",folder).pathname});
  await writeFile(new URL("alpha.json",folder),JSON.stringify(alpha,null,2));await renderPage.close();
 });
 await check("long identity, unicode, exact large amounts, six-digit counts and terminal states",async()=>{
  const original=structuredClone(snapshot);
  for(const status of ["PAUSED","REVOKED","UNAVAILABLE"]){
   Object.assign(snapshot.agent,{name:"Élodie 国際研究 Agent "+"UnbrokenLongName".repeat(5),status});
   Object.assign(snapshot.usage,{fundsMoved:"123456789012345678.000001",requestCount:999999,paidCount:888888,blockedCount:111111});
   for(const width of [320,390,1440]){await page.setViewportSize({width,height:1100});await page.goto(publicPath);await page.locator(".atm-card").waitFor();await fits(page);}
  }
  await capture(page,"long-content");
  await writeFile(new URL("long-content.svg",folder),cardSvg(snapshot.agent,snapshot.usage,snapshot.agent.paymentSymbol));
  Object.assign(snapshot.agent,original.agent);Object.assign(snapshot.usage,original.usage);
  Object.assign(snapshot.usage,{requestCount:0,paidCount:0,blockedCount:0,fundsMoved:"0"});
  await page.goto(publicPath);await page.locator(".atm-card").waitFor();await fits(page);assert.match(await page.locator(".atm-usage").innerText(),/0/);await capture(page,"zero-usage");Object.assign(snapshot.usage,original.usage);
 });
 await check("keyboard focus, share provenance and reduced motion",async()=>{
  await page.emulateMedia({reducedMotion:"reduce"});await page.goto(publicPath);await page.locator(".atm-card").waitFor();
  await page.locator(".atm-card").hover();
  assert.equal(await page.locator(".atm-card").evaluate(el=>getComputedStyle(el.parentElement!).transform),"none");
  const button=page.getByRole("button",{name:"Download card",exact:true});await button.focus();await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button",{name:"PNG",exact:true}).evaluate(el=>el===document.activeElement),true);
  const share=new URL((await page.getByRole("link",{name:"Share on X"}).getAttribute("href"))!);assert.equal(share.searchParams.get("url"),snapshot.shareUrl);assert.ok(share.searchParams.get("text")?.includes(usage.fundsMoved));
  for(const el of await page.locator(".identity-actions .button").all()){const box=await el.boundingBox();assert.ok(box&&box.height>=48);}
 });
 await check("loading, failed fetch retry and failed export recovery",async()=>{
  delayCard=true;await page.goto(publicPath);await page.getByRole("status").filter({hasText:"Loading measured agent usage"}).waitFor();await page.locator(".atm-card").waitFor();delayCard=false;
  cardError=true;await page.reload();await page.getByRole("button",{name:"Retry card"}).waitFor();assert.equal(await page.locator(".atm-card").count(),0);
  cardError=false;await page.getByRole("button",{name:"Retry card"}).click();await page.locator(".atm-card").waitFor();
  downloadError=true;await page.getByRole("button",{name:"PNG",exact:true}).click();await page.getByRole("alert").filter({hasText:"Card service is temporarily unavailable"}).waitFor();assert.equal(await page.locator(".atm-card").count(),1);
  downloadError=false;const download=page.waitForEvent("download");await page.getByRole("button",{name:"PNG",exact:true}).click();assert.equal(await(await download).failure(),null);
 });
 assert.deepEqual(errors,[]);
 await writeFile(new URL("browser-report.json",folder),JSON.stringify({mode:"ISOLATED_PRODUCTION_APP_WITH_REAL_CARD_SERIALIZER",checks,viewports:[320,390,768,1440],pageErrors:errors},null,2));
 console.log("Glossy card browser verification passed");
}finally{
 await browser?.close();if(process.platform==="win32")server.kill("SIGTERM");else if(server.pid)try{process.kill(-server.pid,"SIGTERM")}catch{server.kill("SIGTERM")}
}
