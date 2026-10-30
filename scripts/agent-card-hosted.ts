import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {chromium} from "@playwright/test";
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const id="0x5265d227519c96e186cda7e45d072d18751dca8da58615ca8832bd78527faf37";
const origins=["https://intentguard-tapeout.vercel.app","https://intentguard-gen-daves-projects.vercel.app"];
const folder=".local/glossy-agent-card/hosted";await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true}),results:unknown[]=[];
try{
 for(const origin of origins){
  const configResponse=await fetch(origin+"/api/v1/config",{signal:AbortSignal.timeout(45000)});assert.equal(configResponse.status,200);
  const config=await configResponse.json();assert.equal(config.mode,"testnet");assert.equal(config.chainId,1952);assert.equal(config.sourceCommit,sourceCommit);assert.equal(config.configured,true);
  const response=await fetch(origin+"/api/v1/explorer/agents/"+id+"/card",{signal:AbortSignal.timeout(45000)});assert.equal(response.status,200);
  const snapshot=await response.json();assert.equal(snapshot.agent.id,id);assert.equal(snapshot.agent.chainId,1952);
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("request",request=>{if(new URL(request.url()).pathname.startsWith("/api/v1/explorer/"))assert.equal(request.headers().authorization,undefined)});
  const label=origin===origins[0]?"canonical":"legacy";
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+"/explorer?agentId="+id,{waitUntil:"domcontentloaded"});
   const instrument=page.locator(".atm-card");await instrument.waitFor({timeout:45000});await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.match(await instrument.innerText(),new RegExp(snapshot.agent.name));assert.match(await instrument.innerText(),/TESTNET · NO MONETARY VALUE/);
   await instrument.screenshot({path:folder+"/"+label+"-"+width+".png"});
  }
  const svgDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Download card",exact:true}).click();
  const svg=await svgDownload;assert.equal(await svg.failure(),null);await svg.saveAs(folder+"/"+label+"-card.svg");
  const source=await readFile(folder+"/"+label+"-card.svg","utf8");assert.ok(source.includes(snapshot.usage.fundsMoved));assert.ok(source.includes("intentguard-tapeout.vercel.app"));assert.ok(source.includes("data:font/woff2;base64,"));assert.ok(!/<(?:script|image|foreignObject)\b/.test(source));
  const pngDownload=page.waitForEvent("download");await page.getByRole("button",{name:"PNG",exact:true}).click();
  const png=await pngDownload;assert.equal(await png.failure(),null);await png.saveAs(folder+"/"+label+"-card.png");
  const data=await readFile(folder+"/"+label+"-card.png");
  const alpha=await page.evaluate(async src=>{
   const img=new Image();img.src=src;await img.decode();const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=760;const ctx=canvas.getContext("2d")!;ctx.drawImage(img,0,0);
   return{width:img.naturalWidth,height:img.naturalHeight,corner:ctx.getImageData(0,0,1,1).data[3],face:ctx.getImageData(100,350,1,1).data[3]};
  },"data:image/png;base64,"+data.toString("base64"));
  assert.equal(alpha.width,1200);assert.equal(alpha.height,760);assert.equal(alpha.corner,0);assert.ok(alpha.face>0&&alpha.face<255);assert.deepEqual(errors,[]);
  results.push({origin,sourceCommit,agentId:id,name:snapshot.agent.name,fundsMoved:snapshot.usage.fundsMoved,requestCount:snapshot.usage.requestCount,alpha,viewports:[320,390,1440],walletRequired:false,pageErrors:errors});
  await context.close();console.log("HOSTED_CARD_VERIFIED "+origin);
 }
 await writeFile(folder+"/report.json",JSON.stringify({verifiedAt:new Date().toISOString(),sourceCommit,results},null,2));
}finally{await browser.close()}
