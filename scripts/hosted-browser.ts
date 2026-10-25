import assert from "node:assert/strict";
import {chromium,type Page} from "@playwright/test";
import {loadEnvFile} from "node:process";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {privateKeyToAccount} from "viem/accounts";
import {hexToString,type Hex} from "viem";

const root=new URL("../",import.meta.url);
loadEnvFile(new URL(".local/testnet-secrets.env",root));
loadEnvFile(new URL(".local/hosting.env",root));
assert.equal(process.env.INTENTGUARD_MODE,"testnet");
assert.equal(Number(process.env.XLAYER_CHAIN_ID),1952);
const account=privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex);
const acceptance=JSON.parse(await readFile(new URL(".local/hosted-report.json",root),"utf8"));
assert.equal(acceptance.phase,"COMPLETE","Real hosted protocol acceptance must finish first");
const bases=[process.env.APP_URL!.replace(/\/$/,""),"https://intentguard-ivory.vercel.app"];
const folder=new URL(".local/hosted-screenshots/",root);await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors:string[]=[],results:unknown[]=[];
async function json(page:Page,path:string){
 return page.evaluate(async(path)=>{
  const response=await fetch("/api/v1"+path,{credentials:"same-origin",cache:"no-store"});
  const body=await response.json();
  if(!response.ok)throw Error("Hosted API "+path+" HTTP"+response.status);
  return body;
 },path);
}
async function fits(page:Page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Hosted viewport overflow")}
try{
 for(const [index,base]of bases.entries()){
  assert.equal(new URL(base).protocol,"https:");
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  // The real owner key stays in Node. The browser gets an EIP-1193 adapter that
  // can request only a domain-bound login signature; transaction writes fail.
  let signatures=0;
  await page.exposeBinding("intentguardTestWallet",async(source,args:{method:string;params?:unknown[]})=>{
   assert.equal(new URL(source.page.url()).origin,base);
   if(["eth_accounts","eth_requestAccounts"].includes(args.method))return [account.address];
   if(args.method==="eth_chainId")return "0x7a0";
   if(args.method==="personal_sign"){
    const [raw,address]=args.params??[];
    assert.equal(String(address).toLowerCase(),account.address.toLowerCase());
    const message=hexToString(String(raw) as Hex),lines=message.split("\n");
    assert.equal(lines[0],"IntentGuard owner login");assert.equal(lines[1],new URL(base).host);
    assert.equal(lines[2],account.address.toLowerCase());assert.equal(lines[3],"Chain ID: 1952");
    assert.match(lines[4],/^Nonce: [a-f0-9]{48}$/);assert.equal(lines[6],"This signature authorizes a dashboard session only.");
    assert.ok(Date.parse(lines[5].replace("Expires: ",""))>Date.now());
    signatures++;return account.signMessage({message});
   }
   throw Error("Hosted browser verifier supports login only");
  });
  await context.addInitScript({content:`Object.defineProperty(window,"ethereum",{value:{request:args=>window.intentguardTestWallet(args),on:()=>{},removeListener:()=>{}}})`});
  const response=await page.goto(base,{waitUntil:"domcontentloaded",timeout:60000});assert.equal(response?.status(),200);
  await page.getByRole("heading",{name:/Let your agents spend/}).waitFor({timeout:45000});
  const config=await json(page,"/config");assert.equal(config.mode,"testnet");assert.equal(config.chainId,1952);assert.equal(config.configured,true);
  assert.equal(config.token.toLowerCase(),"0x47f846c659b4df565d2e8b1cd32f610e68d11b9a");
  const latest=await json(page,"/explorer/transactions?limit=4");
  assert.equal(latest.transactions.length,4,"Four actual acceptance records must be visible");
  await page.locator(".transaction-row").first().waitFor();
  assert.equal(await page.locator(".transaction-row").count(),4);
  for(const row of latest.transactions)assert.equal(await page.locator('a[href="/explorer/transactions/'+row.id+'"]').count(),1);
  assert.equal(await page.getByText(/SAMPLE PREVIEW|Sample balances|Browser fixture/).count(),0);
  if(index===0)for(const width of [390,768,1440,1920]){
   await page.setViewportSize({width,height:1000});await fits(page);
   await page.screenshot({path:new URL("landing-"+width+".png",folder).pathname,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+"/agents");await page.getByRole("heading",{name:"Your wallet is the owner."}).waitFor();
  await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();
  await page.getByRole("heading",{name:acceptance.requests.approved? "Hosted Research Agent "+acceptance.runId.slice(0,6):"",exact:true}).waitFor({timeout:45000});
  assert.equal(signatures,1);
  const session=await json(page,"/auth/session");assert.equal(session.address,account.address.toLowerCase());
  const owned=await json(page,"/owner/cards"),card=owned.cards.find((c:{address:string})=>c.address.toLowerCase()===acceptance.cardAddress.toLowerCase());
  assert.ok(card);assert.equal(card.balances.spent,"1");assert.equal(card.balances.reserved,"0");assert.equal(card.balances.available,"9");
  await page.getByRole("tab",{name:"Transactions",exact:true}).click();
  for(const row of Object.values(acceptance.requests) as {id:string}[])await page.locator('a[href="/explorer/transactions/'+row.id+'"]').waitFor();
  if(index===0)await page.screenshot({path:new URL("owner-transactions-1440.png",folder).pathname,fullPage:true});
  await page.goto(base+"/agent-setup");await page.getByLabel("Agent name",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("Agent name",{exact:true}).inputValue(),"");
  await page.goto(base+"/docs");await page.getByRole("heading",{name:"Complete policy reference"}).waitFor();
  await page.getByRole("heading",{name:"Read balances and spending capacity",exact:true}).waitFor();
  await page.getByRole("heading",{name:"Rate limits",exact:true}).waitFor();
  await page.getByRole("heading",{name:"Obtain an invoice",exact:true}).waitFor();
  assert.equal(await page.locator(".docs-article>section").count(),19);
  assert.ok((await page.locator(".docs-article").innerText()).length>22000);
  await page.goto(base+"/explorer");await page.getByRole("tab",{name:"Agents",exact:true}).click();
  await page.getByRole("heading",{name:card.name,exact:true}).waitFor();
  for(const kind of ["approved","semantic"]){
   const record=acceptance.requests[kind];
   await page.goto(base+"/explorer/transactions/"+record.id);
   await page.getByText("Source: finalized GenLayer contract result",{exact:true}).waitFor({timeout:45000});
   assert.equal(await page.getByText(record.review.reason,{exact:true}).isVisible(),true);
   for(const criterion of record.review.criteria)assert.equal(await page.getByText(criterion.reason,{exact:true}).isVisible(),true);
   assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
   if(index===0){await fits(page);await page.screenshot({path:new URL(kind+"-reasoning-1440.png",folder).pathname,fullPage:true})}
  }
  const denied=await page.evaluate(async()=>{
   const r=await fetch("/api/v1/auth/challenge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address:"0x"+"11".repeat(20)})});return r.status;
  });
  assert.equal(denied,200,"Legitimate alias origin must support challenge creation");
  const logout=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/v1/auth/logout"&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  assert.equal((await logout).status(),204);
  assert.equal((await json(page,"/auth/session")).address,null);
  results.push({origin:base,loginSignatures:signatures,latestActualRecords:latest.transactions.map((r:{id:string})=>r.id),card:card.address,balances:card.balances,docsSections:19,verifiedReasoning:["approved","semantic"]});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(new URL("report.json",folder),JSON.stringify({mode:"REAL_HOSTED_BROWSER_AND_API",verifiedAt:new Date().toISOString(),results,pageErrors:errors,viewports:[390,768,1440,1920]},null,2)+"\n");
 console.log("HOSTED_BROWSER_AND_API_PASSED");
}catch(error){
 for(const context of browser.contexts())for(const page of context.pages())console.error("HOSTED_BROWSER_DIAGNOSTIC",JSON.stringify({url:page.url(),alerts:await page.getByRole("alert").allTextContents()}));
 throw error;
}finally{await browser.close()}
