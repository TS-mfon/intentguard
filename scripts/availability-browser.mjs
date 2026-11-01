import assert from "node:assert/strict";
import {chromium} from "@playwright/test";
import {httpsOrigin,publicIdentity,tapeKitIdentity,assertGatewayObservation,assertContentType} from "../tools/production/availability.mjs";

// The default gateway's HTTP response is a bootstrap shell. Only a controlled
// browser can observe the actual bytes fetched and verified from the registry.
export async function observeGatewayFiles(origin,files,{launch=()=>chromium.launch({headless:true})}={}){
 httpsOrigin(origin);assert.ok(tapeKitIdentity(origin));assert.ok(Array.isArray(files)&&files.length>0&&files.length<=5000);
 const browser=await launch();try{
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:"allow"}),page=await context.newPage();
  await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(()=>!!navigator.serviceWorker?.controller&&!document.getElementById("msg"),undefined,{timeout:60000});
  const observations=[];for(const file of files){
   const url=origin+"/"+file.path.replace(/^\//,""),observed=await page.evaluate(async url=>{
    const response=await fetch(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(30000)}),reader=response.body?.getReader(),parts=[];let size=0;
    while(reader){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32*1024*1024){await reader.cancel();throw Error("Gateway response exceeds its bound");}parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}const digest=await crypto.subtle.digest("SHA-256",bytes);
    return {url,status:response.status,size,bodySha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join(""),contentType:response.headers.get("content-type"),gateway:{controllerUrl:navigator.serviceWorker.controller?.scriptURL,name:response.headers.get("x-tape-name"),status:response.headers.get("x-tape-status"),mode:response.headers.get("x-tape-mode"),verified:response.headers.get("x-tape-verified"),sha256:response.headers.get("x-tape-sha256")}};
   },url);
   observed.gateway.browserVersion=browser.version();assertGatewayObservation(observed,origin,file);if(file.size!==undefined)assert.equal(observed.size,file.size);if(file.contentType!==undefined)assertContentType(observed.contentType,file.contentType);observations.push(observed);
  }
  return observations;
 }finally{await browser.close();}
}

export async function observeBrowser(url,target){
 const parsed=new URL(url);httpsOrigin(parsed.origin);assert.ok(target.frontendOrigins.includes(parsed.origin));assert.equal(parsed.pathname,"/agent-setup");
 const browser=await chromium.launch({headless:true});try{const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();let pageErrors=0,credentialRequests=0;
  page.on("pageerror",()=>pageErrors++);page.on("request",request=>{const headers=request.headers();if(headers.authorization||request.url().includes("/auth/verify")||request.url().includes("/owner/"))credentialRequests++;});
  const configuration=page.waitForResponse(response=>response.url()===target.applicationOrigin+"/api/v1/config"&&response.request().method()==="GET",{timeout:60000});const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});assert.equal(response?.status(),200);assert.equal(page.url(),url);const configResponse=await configuration;assert.equal(configResponse.status(),200);publicIdentity(await configResponse.json(),target,"config");
  await page.getByRole("heading",{name:"Your wallet is the owner.",exact:true}).waitFor({timeout:30000});await page.getByRole("button",{name:"Connect wallet",exact:true}).first().waitFor();
  const environment=target.paymentEnvironment==="mainnet"?"Mainnet · real funds":"Testnet · practice";assert.ok(await page.getByText(environment,{exact:true}).isVisible());assert.equal(await page.locator('[data-setup-mode]').count(),0,"No owner setup may load anonymously");assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(pageErrors,0);assert.equal(credentialRequests,0);
  return {url,sourceCommit:target.sourceCommit,paymentEnvironment:target.paymentEnvironment,version:browser.version(),pageErrors,credentialRequests,ownerPromptVisible:true,environmentVisible:true};
 }finally{await browser.close();}
}
