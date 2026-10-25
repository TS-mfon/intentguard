import {chromium,type Page} from "@playwright/test";
import {spawn,type ChildProcess} from "node:child_process";
import {createServer} from "node:net";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";

const external=process.env.STORY_BASE_URL?.replace(/\/$/,"");
let server:ChildProcess|undefined,output="",browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let base=external||"";
const folder=new URL("../.local/story-screenshots/",import.meta.url);
await mkdir(folder,{recursive:true});
const errors:string[]=[],checks:string[]=[];
const widths=[320,390,768,1440,1920];
const ids=["the-instruction","the-mandate","the-circuit","the-evidence","the-transfer"];
async function noOverflow(page:Page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Horizontal overflow at "+await page.evaluate(()=>innerWidth))}
async function stageAt(page:Page,id:string){
  await page.evaluate(id=>{const element=document.getElementById(id);if(!element)throw Error("Missing chapter "+id);scrollTo({top:element.getBoundingClientRect().top+scrollY-innerHeight*.35,behavior:"instant"});},id);
  await page.waitForFunction(id=>{const ids=["the-instruction","the-mandate","the-circuit","the-evidence","the-transfer"];return document.querySelector("[data-story-stage]")?.getAttribute("data-stage")===String(ids.indexOf(id))},id);
}
try{
 if(!external){
  await readFile(new URL("../apps/web/.next/BUILD_ID",import.meta.url),"utf8");
  const port=await new Promise<number>(resolve=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(()=>resolve(typeof a==="object"&&a?a.port:3999))})});
  base="http://127.0.0.1:"+port;
  server=spawn("pnpm",["--filter","@intentguard/web","start","--port",String(port)],{cwd:new URL("../",import.meta.url),stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32",env:{...process.env,APP_URL:base}});
  server.stdout?.on("data",c=>output+=c.toString());server.stderr?.on("data",c=>output+=c.toString());
  const deadline=Date.now()+60000;while(Date.now()<deadline){if(await fetch(base+"/why-we-exist").then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,500))}
 }
 const response=await fetch(base+"/why-we-exist",{signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,"Story route must be public");
 const html=await response.text();assert.ok(html.includes("WHY WE"),"Story is server-rendered");
 const media=await fetch(base+"/motion/protocol-story.mp4",{signal:AbortSignal.timeout(60000)});
 assert.equal(media.status,200,"Real protocol film is delivered");
 assert.match(media.headers.get("content-type")||"",/video\/mp4/);
 const mediaBuffer=Buffer.from(await media.arrayBuffer());assert.ok(mediaBuffer.includes(Buffer.from("ftyp")),"MP4 container signature");
 assert.ok(mediaBuffer.length>100000&&mediaBuffer.length<=8*1024*1024,"Film size budget, actual downloaded media");
 const poster=await fetch(base+"/motion/protocol-story-poster.jpg",{signal:AbortSignal.timeout(30000)});
 assert.equal(poster.status,200);assert.match(poster.headers.get("content-type")||"",/image\/jpeg/);
 const posterBuffer=Buffer.from(await poster.arrayBuffer());assert.equal(posterBuffer[0],255);assert.equal(posterBuffer[1],216);assert.ok(posterBuffer.length<=300*1024,"Poster size budget");
 checks.push("public SSR route and real MP4/JPEG delivery");

 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"no-preference"});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
 await page.goto(base+"/why-we-exist",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"WHY WE EXIST.",level:1}).waitFor();
 const film=page.locator("video[aria-label='IntentGuard protocol story film']");
 await page.waitForFunction(()=>{const v=document.querySelector("video");return !!v&&v.readyState>=2},undefined,{timeout:45000});
 await page.waitForFunction(()=>{const v=document.querySelector("video");return !!v&&getComputedStyle(v).visibility==="visible"&&document.querySelector("[data-story-film]")?.getAttribute("data-film-state")!=="loading"});
 assert.equal(await page.getByText("Preparing the protocol film…",{exact:true}).count(),0,"Ready video must replace the loading poster");
 assert.equal(await film.evaluate(v=>(v as HTMLVideoElement).muted),true,"Initial playback must be muted");
 assert.equal(await film.evaluate(v=>v.hasAttribute("autoplay")),false,"Playback controlled with reduced-motion awareness");
 const duration=await film.evaluate(v=>(v as HTMLVideoElement).duration);assert.ok(duration>=24&&duration<=32,"24–32 second story film");
 assert.equal(await page.locator("img[src='/motion/protocol-story-poster.jpg']").evaluate(v=>(v as HTMLImageElement).naturalWidth>0),true,"Poster decoded");
 checks.push("muted initial playback, decoded poster and measured story duration");

 if(await page.getByRole("button",{name:"Pause film",exact:true}).count())await page.getByRole("button",{name:"Pause film",exact:true}).click();
 await page.getByRole("button",{name:"Play story with sound",exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector("video");return !!v&&!v.paused&&!v.muted&&v.volume>0});
 await page.getByRole("button",{name:"Pause film",exact:true}).focus();await page.keyboard.press("Space");
 await page.waitForFunction(()=>document.querySelector("video")?.paused===true);
 await page.getByRole("button",{name:"Play film",exact:true}).focus();await page.keyboard.press("Enter");
 await page.waitForFunction(()=>document.querySelector("video")?.paused===false);
 await page.getByRole("button",{name:"Mute sound",exact:true}).click();
 assert.equal(await film.evaluate(v=>(v as HTMLVideoElement).muted),true);
 await page.getByRole("button",{name:"Turn sound on",exact:true}).click();
 assert.equal(await film.evaluate(v=>(v as HTMLVideoElement).muted),false);
 await page.getByRole("slider",{name:"Film volume"}).focus();await page.keyboard.press("End");await page.keyboard.press("ArrowLeft");
 await page.waitForFunction(()=>Math.abs((document.querySelector("video")?.volume||0)-.99)<.001);
 assert.equal(await page.evaluate(()=>localStorage.getItem("intentguard-story-volume")),"0.99");
 await page.getByRole("button",{name:"Replay film",exact:true}).click();
 assert.ok(await film.evaluate(v=>(v as HTMLVideoElement).currentTime<2));
 await film.evaluate(v=>{const video=v as HTMLVideoElement;video.currentTime=video.duration-.08});
 await page.waitForFunction(()=>document.querySelector("video")?.ended===true);
 await page.getByRole("button",{name:"Replay story with sound",exact:true}).waitFor();
 await page.getByRole("button",{name:"Replay film",exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector("video");return !!v&&!v.paused&&!v.ended&&v.currentTime<2});
 checks.push("gesture-only sound, keyboard play/pause, mute, volume, ended state and replay");

 // A hidden document must suspend sound and playback immediately.
 await page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');
 await page.waitForFunction(()=>document.querySelector("video")?.paused===true);
 await page.evaluate(()=>{delete (document as unknown as {hidden?:boolean}).hidden;document.dispatchEvent(new Event("visibilitychange"))});
 await page.waitForFunction(()=>document.querySelector("video")?.paused===false);
 const startTime=await film.evaluate(v=>(v as HTMLVideoElement).currentTime);
 await page.waitForFunction(time=>(document.querySelector("video")?.currentTime||0)>time+.2,startTime);
 assert.equal(await film.evaluate(v=>getComputedStyle(v).visibility),"visible","Playing frames must be visible above the poster");
 checks.push("document visibility suspends playback and audio; actual visible frames advance");

 let firstProgress=0,lastProgress=0,firstPosition="";
 for(const [index,id] of ids.entries()){
  await stageAt(page,id);
  const progress=Number(await page.locator("[data-story-journey]").getAttribute("data-progress"));
  if(index===0){firstProgress=progress;firstPosition=await page.locator("[data-story-stage]").evaluate(v=>getComputedStyle(v.parentElement!).getPropertyValue("--card-y"))}
  if(index===4)lastProgress=progress;
  const current=page.getByRole("navigation",{name:"Protocol story chapters"}).locator('[aria-current="step"]');
  assert.equal(await current.getAttribute("href"),"#"+id);
  if(index===2){
   await page.getByRole("button",{name:"Show blocked path",exact:true}).click();
   await page.waitForFunction(()=>document.querySelector("[data-story-stage]")?.getAttribute("data-blocked")==="true");
   assert.ok((await page.locator("[data-story-stage]").innerText()).includes("EVIDENCE REVIEW SKIPPED"));
   await page.screenshot({path:new URL("blocked-path-1440.png",folder).pathname});
   await page.getByRole("button",{name:"Show permitted path",exact:true}).click();
   assert.equal(await page.locator("[data-story-stage]").getAttribute("data-blocked"),"false");
  }
  await page.screenshot({path:new URL(id+"-1440.png",folder).pathname});
 }
 assert.ok(lastProgress-firstProgress>.65,"Request progress moves through the whole journey");
 assert.notEqual(await page.locator("[data-story-stage]").evaluate(v=>getComputedStyle(v.parentElement!).getPropertyValue("--card-y")),firstPosition,"ATM card follows the mechanical path");
 await page.waitForFunction(()=>document.querySelector("video")?.paused===true);
 const offscreenTime=await film.evaluate(v=>(v as HTMLVideoElement).currentTime);await page.waitForTimeout(400);
 assert.ok(Math.abs(await film.evaluate(v=>(v as HTMLVideoElement).currentTime)-offscreenTime)<.05,"Offscreen film stays paused");
 checks.push("five native-scroll chapters, active anchors, moving path/card, skipped review branch and offscreen suspension");

 for(const width of widths){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>scrollTo({top:0,behavior:"instant"}));await noOverflow(page);
  await page.screenshot({path:new URL("hero-"+width+".png",folder).pathname});
  for(const id of ids){await stageAt(page,id);await noOverflow(page)}
  if(width===320||width===390||width===768)await page.screenshot({path:new URL("transfer-"+width+".png",folder).pathname});
 }
 checks.push("no horizontal overflow at 320, 390, 768, 1440 and 1920 pixels");
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo({top:0,behavior:"instant"}));
 await page.emulateMedia({reducedMotion:"reduce"});await page.waitForFunction(()=>document.querySelector("video")?.paused===true);
 assert.equal(await page.locator("[data-story-journey]").getAttribute("data-reduced-motion"),"true");
 const staticTransform=await page.locator("[data-story-viewport]").evaluate(v=>getComputedStyle(v).transform);
 assert.equal(staticTransform,"none");
 await page.getByRole("button",{name:"Play story with sound",exact:true}).click();await page.waitForFunction(()=>document.querySelector("video")?.paused===false);
 await page.getByRole("button",{name:"Pause film",exact:true}).click();
 await page.screenshot({path:new URL("reduced-motion-1440.png",folder).pathname});
 checks.push("reduced motion pauses autoplay and scroll effects; deliberate playback remains available");

 // Fresh load with reduced motion checks default state, independent of a previous playing session.
 const reducedContext=await browser.newContext({viewport:{width:390,height:900},reducedMotion:"reduce"});
 const reducedPage=await reducedContext.newPage();reducedPage.on("pageerror",e=>errors.push(e.message));
 await reducedPage.goto(base+"/why-we-exist",{waitUntil:"domcontentloaded"});
 await reducedPage.waitForFunction(()=>{const v=document.querySelector("video");return !!v&&v.readyState>=2},undefined,{timeout:45000});
 assert.equal(await reducedPage.locator("video").evaluate(v=>(v as HTMLVideoElement).paused),true);
 assert.equal(await reducedPage.locator("video").evaluate(v=>(v as HTMLVideoElement).muted),true);
 await noOverflow(reducedPage);await reducedContext.close();
 checks.push("fresh reduced-motion visit never autoplays");

 // A real network failure is a negative control; retry must recover real media.
 const failureContext=await browser.newContext({viewport:{width:390,height:900},reducedMotion:"reduce"});
 const failurePage=await failureContext.newPage();failurePage.on("pageerror",e=>errors.push(e.message));
 await failureContext.route("**/motion/protocol-story.mp4",route=>route.abort("failed"));
 await failurePage.goto(base+"/why-we-exist",{waitUntil:"domcontentloaded"});
 await failurePage.getByRole("alert").filter({hasText:"The film could not load."}).waitFor({timeout:30000});
 assert.equal(await failurePage.locator("img[src='/motion/protocol-story-poster.jpg']").evaluate(v=>(v as HTMLImageElement).naturalWidth>0),true);
 assert.equal(await failurePage.getByRole("heading",{name:"The amount fits. Does the reason?",level:2}).count(),1);
 await noOverflow(failurePage);
 await failurePage.screenshot({path:new URL("film-error-390.png",folder).pathname});
 await failureContext.unroute("**/motion/protocol-story.mp4");
 await failurePage.getByRole("button",{name:"Retry film",exact:true}).click();
 await failurePage.waitForFunction(()=>{const v=document.querySelector("video");return !!v&&v.readyState>=2&&!v.error},undefined,{timeout:45000});
 assert.equal(await failurePage.getByRole("alert").filter({hasText:"The film could not load."}).count(),0);
 await failureContext.close();
 checks.push("actual film request failure preserves poster/text and retry recovers real media");

 assert.deepEqual(errors,[]);
 await writeFile(new URL("browser-report.json",folder),JSON.stringify({mode:external?"HOSTED_REAL_ROUTE_AND_MEDIA":"PRODUCTION_REAL_ROUTE_AND_MEDIA",base,viewports:widths,media:{bytes:mediaBuffer.length,posterBytes:posterBuffer.length,duration},checks,pageErrors:errors},null,2));
 console.log("Story browser verification passed");
}catch(error){if(browser)for(const c of browser.contexts())for(const page of c.pages())console.error("STORY_DIAGNOSTIC",JSON.stringify({url:page.url(),stage:await page.locator("[data-story-journey]").getAttribute("data-active").catch(()=>null),film:await page.locator("video").evaluate(v=>({paused:(v as HTMLVideoElement).paused,muted:(v as HTMLVideoElement).muted,readyState:(v as HTMLVideoElement).readyState,documentHidden:document.hidden,visibility:document.visibilityState,error:(v as HTMLVideoElement).error?.message})).catch(()=>null),alerts:await page.getByRole("alert").allTextContents()}));if(output)console.error(output.slice(-3000));throw error}
finally{await browser?.close();if(server){if(process.platform==="win32")server.kill("SIGTERM");else if(server.pid)try{process.kill(-server.pid,"SIGTERM")}catch{server.kill("SIGTERM")}}}
