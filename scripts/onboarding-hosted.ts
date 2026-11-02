import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import {loadEnvFile} from "node:process";
import {chromium,type Page} from "@playwright/test";
import {hexToString,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {setupGuidance,validateSetup} from "../apps/web/components/setup-form";
import {setupFromTemplate} from "../apps/web/components/agent-templates";
import {policySchema} from "../packages/shared";

// The private owner key stays in Node; this browser adapter only signs login.
for(const file of [".local/testnet-secrets.env",".local/hosting.env"])loadEnvFile(file);
assert.equal(process.env.INTENTGUARD_MODE,"testnet");assert.equal(process.env.XLAYER_CHAIN_ID,"1952");
const account=privateKeyToAccount(process.env.XLAYER_OPERATOR_PRIVATE_KEY as Hex);
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const origins=["https://intentguard-tapeout.vercel.app","https://intentguard-gen-daves-projects.vercel.app"];
const folder=".local/dual-release/hosted-onboarding";await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true}),errors:string[]=[],results:unknown[]=[];
async function fits(page:Page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Hosted viewport overflow");}
try{
 for(const [index,origin]of origins.entries()){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.setDefaultTimeout(30000);page.on("pageerror",error=>errors.push(error.message));
  const configResponse=await context.request.get(origin+"/api/v1/config");assert.equal(configResponse.status(),200);
  const config=await configResponse.json();assert.equal(config.sourceCommit,sourceCommit);assert.equal(config.paymentEnvironment,"testnet");assert.equal(config.chainId,1952);assert.equal(config.reviewChainId,61999);assert.equal(config.configured,true);assert.equal(config.apiOrigin,origin);assert.ok(config.frontendOrigins.includes(origin));assert.ok(config.setupMerchant);
  const healthResponse=await context.request.get(origin+"/api/v1/health"),health=await healthResponse.json();
  assert.equal(healthResponse.status(),200);assert.equal(health.status,"ready");assert.equal(health.sourceCommit,sourceCommit);assert.equal(health.database,"reachable");assert.equal(health.worker.fresh,true);
  let signatures=0,proposalPosts=0;page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/v1/owner/drafts")proposalPosts++;});
  await page.exposeBinding("onboardingOwnerLogin",async(source,args:{method:string;params?:unknown[]})=>{
   assert.equal(new URL(source.page.url()).origin,origin);
   if(["eth_accounts","eth_requestAccounts"].includes(args.method))return [account.address];
   if(args.method==="eth_chainId")return "0x7a0";
   assert.equal(args.method,"personal_sign","Hosted verification supports login only");
   const[raw,address]=args.params??[];assert.equal(String(address).toLowerCase(),account.address.toLowerCase());
   const message=hexToString(String(raw) as Hex),lines=message.split("\n");
   assert.equal(lines.length,10);assert.deepEqual(lines.slice(0,7),["IntentGuard owner login",new URL(origin).host,account.address.toLowerCase(),"URI: "+origin,"API: "+origin,"Payment environment: testnet","Chain ID: 1952"]);
   assert.match(lines[7],/^Nonce: [a-f0-9]{48}$/);assert.ok(Date.parse(lines[8].replace("Expires: ",""))>Date.now());assert.equal(lines[9],"This signature authorizes a dashboard session only.");
   signatures++;return account.signMessage({message});
  });
  await context.addInitScript({content:'Object.defineProperty(window,"ethereum",{value:{request:args=>window.onboardingOwnerLogin(args),on:()=>{},removeListener:()=>{}}})'});
  await page.goto(origin+"/agents");await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();await page.getByRole("button",{name:"Sign out",exact:true}).waitFor();
  const cardsResponse=await context.request.get(origin+"/api/v1/owner/cards");assert.equal(cardsResponse.status(),200);
  const cards=(await cardsResponse.json()).cards;assert.ok(cards.length>0);
  await page.getByRole("searchbox",{name:"Search my agents"}).waitFor();
  const first=cards[0];for(const card of cards){assert.ok(card.usage);assert.equal(card.usage.chainId,1952);assert.equal(card.usage.token.toLowerCase(),card.token.toLowerCase());}
  await page.getByRole("searchbox",{name:"Search my agents"}).fill(first.name);await page.locator('a[href*="agent='+first.id+'"]').click();
  await page.waitForURL(url=>url.pathname==="/agents"&&url.searchParams.get("agent")===first.id);assert.equal(new URL(page.url()).searchParams.get("agent"),first.id);await page.getByRole("tab",{name:"Overview",exact:true}).waitFor();
  await page.getByRole("link",{name:"Back to my agents",exact:true}).click();await page.waitForURL(url=>url.pathname==="/agents"&&!url.searchParams.has("agent"));assert.equal(await page.getByRole("searchbox",{name:"Search my agents"}).inputValue(),first.name);
  await page.getByRole("searchbox",{name:"Search my agents"}).fill("");
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await fits(page);}
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:folder+"/gallery-"+index+".png",fullPage:true});
  for(const template of ["research","api-access","protocol-test"] as const){
   await page.goto(origin+"/agent-setup");await page.getByRole("button",{name:/Choose template/}).click();await page.getByRole("radio",{name:new RegExp(template==="research"?"Research assistant":template==="api-access"?"API access":"Protocol test")}).check();
   await page.getByRole("button",{name:"Continue",exact:true}).click();
   const form=setupFromTemplate(template,1952,Date.now(),config.setupMerchant);
   assert.equal(await page.getByLabel("Agent name",{exact:true}).inputValue(),form.name);
   await page.getByText("Money & validity",{exact:true}).click();assert.equal(await page.getByLabel("Lifetime budget · USDC",{exact:true}).inputValue(),"1");assert.equal(await page.getByLabel("Per-payment limit · USDC",{exact:true}).inputValue(),"0.01");assert.ok(await page.getByLabel("Valid until · UTC",{exact:true}).inputValue());
   await page.getByText("Purchase permissions",{exact:true}).click();assert.equal(await page.getByLabel("Allowed purchase categories").inputValue(),form.categories);
   await page.getByText("Required evidence",{exact:true}).click();assert.equal(await page.getByLabel("Evidence types").inputValue(),form.evidenceTypes);
   if(template==="protocol-test"){assert.deepEqual(validateSetup(form),{});assert.equal(policySchema.safeParse(setupGuidance(form)).success,true);assert.equal(await page.getByLabel("Recipient address",{exact:true}).inputValue(),config.setupMerchant.recipient);}
  }
  await page.reload();await page.getByLabel("Agent name",{exact:true}).waitFor();assert.equal(await page.getByLabel("Agent name",{exact:true}).inputValue(),"Protocol test");
  await page.getByRole("button",{name:"Manual setup",exact:true}).click();assert.equal(await page.getByLabel("Agent name",{exact:true}).inputValue(),"Protocol test");await page.getByRole("button",{name:"Quick setup",exact:true}).click();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await fits(page);}
  await page.setViewportSize({width:390,height:1000});await page.screenshot({path:folder+"/setup-"+index+".png",fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(proposalPosts,0);assert.equal(signatures,1);
  await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByRole("heading",{name:"Your wallet is the owner."}).waitFor();
  results.push({origin,sourceCommit,releaseId:config.releaseId,ownedCards:cards.length,ownerLoginSignatures:signatures,templates:["research","api-access","protocol-test"],protocolMerchant:config.setupMerchant,healthy:true,proposalPosts,viewports:[320,390,768,1440]});
  await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(folder+"/report.json",JSON.stringify({version:1,kind:"live-hosted-onboarding-and-read-only-owner-controls",sourceCommit,verifiedAt:new Date().toISOString(),results,pageErrors:errors,activationTested:false,newConsensusResults:false,actualMainnetAcceptance:false},null,2)+"\n");
 console.log("HOSTED_ONBOARDING_VERIFIED");
}finally{await browser.close();}
