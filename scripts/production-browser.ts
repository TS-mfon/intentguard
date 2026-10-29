import assert from "node:assert/strict";
import {createServer,type Server} from "node:https";
import {mkdtemp,readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {chromium,type Page} from "@playwright/test";
import {privateKeyToAccount} from "viem/accounts";
import {decodeFunctionData,parseAbi} from "viem";
import {createApi} from "../apps/web/lib/api";
import {MemoryStore} from "../apps/web/lib/store";
import {STUDIONET_CONSENSUS} from "../apps/web/lib/config";
import {card,policy,input,FakeEvm} from "../tests/fixtures";
import {digest,type Settlement} from "../packages/shared";
import {profileRoutes,sourceToken} from "../packages/shared/payment-profiles";
import {buildStatic} from "./static-frontend.mjs";
import {gatewayResolve} from "../tools/hosting/bundle.mjs";

const root=resolve(import.meta.dirname,".."),temporary=await mkdtemp(join(tmpdir(),"intentguard-browser-"));
const folder=join(root,".local","production-frontend");await mkdir(folder,{recursive:true});
const account=privateKeyToAccount(("0x"+"14".repeat(32)) as `0x${string}`),owner=account.address.toLowerCase();
const address=(value:string)=>"0x"+value.repeat(20),hash=(value:string)=>"0x"+value.repeat(32);
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-keyout",join(temporary,"key.pem"),"-out",join(temporary,"cert.pem"),"-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore"});
const tls={key:await readFile(join(temporary,"key.pem")),cert:await readFile(join(temporary,"cert.pem"))};
async function listen(server:Server,port=0){await new Promise<void>((done,fail)=>{server.once("error",fail);server.listen(port,"127.0.0.1",done);});const endpoint=server.address();assert.ok(endpoint&&typeof endpoint==="object");return endpoint.port;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
const environment=(process.argv.find(a=>a.startsWith("--environment="))?.split("=")[1]??"mainnet") as "mainnet"|"testnet";
assert.ok(["mainnet","testnet"].includes(environment));
const mainnet=environment==="mainnet",chainId=mainnet?196:1952,networks=profileRoutes(environment);
const sourceCard={...card,owner,chainId,token:sourceToken(environment,"USDC"),paymentEnvironment:environment,reviewNetwork:"studionet" as const,reviewGenesis:hash("77"),reviewConsensus:STUDIONET_CONSENSUS,reviewerVersion:4,settlement:{version:2,paymentEnvironment:environment,asset:"USDC",destinationChainIds:[chainId]} as Settlement};
const store=new MemoryStore();await store.create("cards",sourceCard);
const now=Date.now(),records=Array.from({length:5},(_,i)=>({id:"0x"+String(i+1).padStart(64,"0"),cardId:card._id,agentName:policy.name,status:i===1?"BLOCKED":"PAID",amount:"1.000001",recipient:input.recipient,category:"data",purchaseDescription:"Isolated browser fixture "+(i+1),createdAt:now-i*10000,updatedAt:now,requestHash:hash("bb"),evidenceHash:hash("cc"),chainId,token:sourceCard.token,paymentSymbol:"USDC",guard:{allow:i!==1,failures:i===1?["Payment limit"]:[],txHash:hash("dd")},review:i===1?undefined:{decision:"APPROVE",requestHash:hash("bb"),policyHash:digest(policy),evidenceHash:hash("cc"),reason:"Isolated finalized reasoning fixture.",criteria:[{id:"mission",status:"PASS",reason:"Committed fixture invoice supports the research mandate.",sources:["https://merchant.example/invoice","javascript:alert(1)"]}]},genLayerTxHash:i===1?undefined:hash("ee"),paymentTxHash:i===1?undefined:hash("ff")}));
const publicAgent={id:card._id,name:policy.name,mission:policy.mission,address:card.address,owner,policyHash:digest(policy),chainId,token:sourceCard.token,paymentSymbol:"USDC",status:"ACTIVE",reviewerAddress:sourceCard.reviewerAddress,createdAt:now,financial:policy.financial,criteria:policy.criteria,balances:{available:"10",spent:"4.000004",reserved:"0"}};
let apiOrigin="",frontendOrigin="",directory="",paths=new Map<string,{contentType:string}>(),publicMode="populated",configMismatch=false,unverified=false,proofTampered=false,downloadError=false;
let lastReplacement:Record<string,unknown>|null=null;const requests:{path:string;method:string;origin:string|null;authorization:string|null;environment:string|null}[]=[],checks:string[]=[],errors:string[]=[];
class BrowserEvm extends FakeEvm{
 override async view(value:Parameters<FakeEvm["view"]>[0]){return {...await super.view(value),chainId:value.chainId??chainId,paymentEnvironment:value.paymentEnvironment??environment,reviewerVersion:value.reviewerVersion,settlement:value.settlement,reviewEnvironment:"testnet" as const,reviewNetwork:"studionet" as const,reviewChainId:61999 as const};}
}
const api=createApi(store,new BrowserEvm(),{wake:()=>{}});
const apiServer=createServer(tls,async(req,res)=>{
 try{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const url=new URL(req.url||"/",apiOrigin),headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(", "):v);
  const method=req.method||"GET",bytes=Buffer.concat(chunks),r=new Request(url,{method,headers,...(!["GET","HEAD"].includes(method)&&bytes.length?{body:bytes}:{} )});
  const path=url.pathname.replace("/api/v1","");requests.push({path,method,origin:r.headers.get("origin"),authorization:r.headers.get("authorization"),environment:r.headers.get("x-intentguard-environment")});
  let result:Response;
  if(method==="OPTIONS"||path.startsWith("/auth/")||path==="/config"||path.startsWith("/owner/")){
   if(path.endsWith("/replacement")&&method==="POST")lastReplacement=JSON.parse(bytes.toString());
   result=await api(r,path);
   if(path==="/config"&&method==="GET"){const config=await result.json();if(configMismatch)config.paymentEnvironment=mainnet?"testnet":"mainnet";if(unverified){config.configured=false;config.assets=[];config.spendingNetworks=[];}result=Response.json(config,{status:result.status,headers:result.headers});}
  }else{
   const cors={"Access-Control-Allow-Origin":frontendOrigin,"Access-Control-Expose-Headers":"X-Request-Id, Retry-After","Cache-Control":"no-store"};
   let data:unknown,status=200;
   if(path==="/explorer/transactions"){
    if(publicMode==="error"){status=503;data={error:{code:"UNAVAILABLE",message:"Public index is temporarily unavailable."}};}else data={transactions:publicMode==="empty"?[]:records.slice(0,Number(url.searchParams.get("limit")??20)),nextCursor:null};
   }else if(path==="/explorer/agents")data={agents:publicMode==="empty"?[]:[publicAgent],nextCursor:null};
   else if(path.endsWith("/proof")){const proof={requestId:records[0].id,paymentEnvironment:environment,sourceChainId:chainId,destinationChainId:mainnet?8453:84532,trustBoundary:"Isolated browser proof; not live payment evidence."};data={id:records[0].id,proof:proofTampered?{...proof,destinationChainId:1}:proof,proofHash:digest(proof),verification:"Isolated browser commitment fixture"};}
   else if(path.endsWith("/card.svg")){
    if(downloadError){status=503;data={error:{code:"UNAVAILABLE",message:"Card service is temporarily unavailable."}};}
    else{result=new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760"><text x="50" y="100">Research Agent · 5 requests · 4.000004 USDC</text></svg>',{headers:{...cors,"Content-Type":"image/svg+xml","Content-Disposition":"attachment; filename=agent.svg"}});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;}
   }else if(path.endsWith("/card"))data={agent:publicAgent,usage:{requestCount:5,paidCount:4,blockedCount:1,rejectedCount:0,needsEvidenceCount:0,cancelledCount:0,activeCount:0,fundsMoved:"4.000004",token:sourceCard.token,chainId,asOf:now},shareUrl:frontendOrigin+"/explorer?agentId="+card._id+"&view=agents"};
   else if(path.startsWith("/explorer/transactions/")){
    const id=path.split("/").at(-1),transaction=records.find(t=>t.id===id);if(!transaction){status=404;data={error:{code:"NOT_FOUND",message:"Transaction not found"}};}else data={transaction:id===records[0].id?{...transaction,bridge:{protocol:"CCTP_V2",phase:"CONFIRMED",sourceChainId:chainId,destinationChainId:mainnet?8453:84532,destinationDomain:networks[mainnet?8453:84532].domain,amount:transaction.amount,sourceToken:sourceCard.token,destinationToken:networks[mainnet?8453:84532].token,sourceTxHash:hash("12"),destinationTxHash:hash("13"),confirmationTxHash:hash("14"),updatedAt:now}}:transaction,agent:publicAgent,reasoningSource:transaction.status==="BLOCKED"?"skipped":"genlayer-finalized-contract"};
   }else{status=404;data={error:{code:"NOT_FOUND",message:"Isolated endpoint unavailable"}};}
   result=Response.json(data,{status,headers:cors});
  }
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 }catch(e){res.writeHead(500,{"Content-Type":"text/plain"});res.end(String(e));}
});
const frontendServer=createServer(tls,async(req,res)=>{
 const path=gatewayResolve(req.url||"/",new Set(paths.keys()));if(!path){res.writeHead(404);res.end();return;}
 try{const bytes=await readFile(join(directory,path));res.writeHead(200,{"Content-Type":paths.get(path)!.contentType,"Cache-Control":"no-store"});res.end(bytes);}catch{res.writeHead(503);res.end();}
});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function outcome(name:string,run:()=>Promise<void>){await run();checks.push(name);console.log("BROWSER_CHECK "+name);}
async function noOverflow(page:Page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Viewport overflow: "+page.url());}
try{
 const reusable=process.argv.includes("--reuse")?JSON.parse(await readFile(join(root,".local/static-frontend/manifest.json"),"utf8")):null;
 if(reusable){assert.equal(reusable.paymentEnvironment,environment);assert.equal(reusable.sourceCommit,sourceCommit);for(const[path,expected]of Object.entries(reusable.sourceInputs)){assert.equal(createHash("sha256").update(await readFile(join(root,path))).digest("hex"),expected,"Build input changed: "+path);}}
 apiOrigin="https://127.0.0.1:"+await listen(apiServer,reusable?Number(new URL(reusable.apiOrigin).port):0);frontendOrigin="https://localhost:"+await listen(frontendServer,reusable?Number(new URL(reusable.frontendOrigin).port):0);
 const genesis=hash("77"),netlist=hash("33"),contracts={factoryAddress:address("55"),cctpFactoryAddress:address("66"),gateway:address("11"),attestor:address("22"),processor:address("88"),beacon:address("99"),expectedImplementation:address("aa"),interpreter:address("44")};
 const manifest={version:1,paymentEnvironment:environment,paymentChainId:chainId,releaseId:"isolated-browser-"+environment,sourceCommit,applicationOrigin:apiOrigin,frontendOrigin,databaseName:mainnet?"intentguard_mainnet":"intentguard",reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewGenesis:genesis,reviewConsensus:STUDIONET_CONSENSUS,contracts,circuitId:"1",netlistHash:netlist,codeHashes:{factoryAddress:netlist,cctpFactoryAddress:netlist,processor:netlist,beacon:netlist,expectedImplementation:netlist},enabledAssets:mainnet?["USDC","USDT0"]:["USDC"],verifiedDestinationChainIds:Object.keys(networks).map(Number),verifiedAt:new Date().toISOString()};
 const manifestBytes=JSON.stringify(manifest),manifestPath=join(temporary,"runtime.json");await writeFile(manifestPath,manifestBytes);
 Object.assign(process.env,{INTENTGUARD_MODE:environment,INTENTGUARD_PAYMENT_ENV:environment,XLAYER_CHAIN_ID:String(chainId),MONGODB_DB:manifest.databaseName,MONGODB_URI:"memory://isolated-browser-fixture",APP_URL:apiOrigin,FRONTEND_URL:frontendOrigin,SESSION_SECRET:"isolated-browser-session-secret-over-32-characters",GENLAYER_NETWORK:"studionet",GENLAYER_CHAIN_ID:"61999",GENLAYER_GENESIS_HASH:genesis,GENLAYER_CONSENSUS_ADDRESS:STUDIONET_CONSENSUS,GENLAYER_INTERPRETER_ADDRESS:contracts.interpreter,CARD_FACTORY_ADDRESS:contracts.factoryAddress,CCTP_CARD_FACTORY_ADDRESS:contracts.cctpFactoryAddress,GATEWAY_ADDRESS:contracts.gateway,ATTESTOR_ADDRESS:contracts.attestor,TAPEOUT_PROCESSOR:contracts.processor,TAPEOUT_CIRCUIT_ID:"1",TAPEOUT_BEACON:contracts.beacon,TAPEOUT_IMPLEMENTATION:contracts.expectedImplementation,TAPEOUT_NETLIST_HASH:netlist,INTENTGUARD_RELEASE_ID:manifest.releaseId,INTENTGUARD_SOURCE_COMMIT:sourceCommit,INTENTGUARD_VERIFIED_MANIFEST:manifestPath,INTENTGUARD_VERIFIED_MANIFEST_SHA256:createHash("sha256").update(manifestBytes).digest("hex"),PAYMENT_TOKEN:mainnet?sourceToken("mainnet","USDT0"):sourceCard.token});
 const built=reusable?{directory:join(root,".local/static-frontend/out"),manifest:reusable}:await buildStatic({paymentEnvironment:environment,apiOrigin,frontendOrigin,sourceCommit});directory=built.directory;paths=new Map(built.manifest.bundle.files.map((f:{path:string;contentType:string})=>[f.path,{contentType:f.contentType}]));
 browser=await chromium.launch({headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"]});
 await context.exposeFunction("signBrowserMessage",(raw:string)=>account.signMessage({message:{raw:raw as `0x${string}`}}));
 await context.addInitScript({content:`window.browserAccounts=[${JSON.stringify(owner)}];window.browserListeners={};window.browserTransactions=[];window.browserMethods=[];Object.defineProperty(window,'ethereum',{value:{on:(e,h)=>window.browserListeners[e]=h,removeListener:e=>delete window.browserListeners[e],request:async({method,params})=>{window.browserMethods.push(method);if(['eth_accounts','eth_requestAccounts'].includes(method))return window.browserAccounts;if(method==='eth_chainId')return ${JSON.stringify("0x"+chainId.toString(16))};if(method==='personal_sign'){if(window.deferBrowserSignature)return new Promise(resolve=>window.resolveBrowserSignature=()=>window.signBrowserMessage(params[0]).then(resolve));return window.signBrowserMessage(params[0]);}if(method==='eth_sendTransaction'){window.browserTransactions.push(params[0]);throw Object.assign(new Error('User rejected wallet request'),{code:4001});}throw new Error('Unexpected wallet method '+method);}}});`});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await outcome("latest-three records, empty and error recovery",async()=>{
  await page.goto(frontendOrigin);await page.locator(".transaction-row").first().waitFor();assert.equal(await page.locator(".transaction-row").count(),3);assert.match(await page.locator(".hero-note").innerText(),mainnet?/mainnet.*Studionet testnet/s:/testnet.*no monetary value/s);
  assert.ok(requests.filter(r=>r.path.startsWith("/explorer/")&&r.method!=="OPTIONS").every(r=>!r.authorization&&r.environment===environment&&r.origin===frontendOrigin));
  publicMode="empty";await page.reload();await page.getByRole("heading",{name:"No transactions yet"}).waitFor();assert.equal(await page.locator(".transaction-row").count(),0);
  publicMode="error";await page.reload();await page.getByRole("alert").filter({hasText:"Public index is temporarily unavailable."}).waitFor();assert.equal(await page.getByRole("heading",{name:"No transactions yet"}).count(),0);
  publicMode="populated";await page.getByRole("button",{name:"Retry",exact:true}).click();await page.locator(".transaction-row").first().waitFor();
 });
 await outcome("query, legacy fallback, invalid and blocked transaction routes",async()=>{
  await page.locator(".transaction-row").first().click();await page.getByText("Source: finalized GenLayer contract result",{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get("id"),records[0].id);assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
  await page.goto(frontendOrigin+"/explorer/transactions/"+records[0].id);await page.getByText("Source: finalized GenLayer contract result",{exact:true}).waitFor();
  await page.goto(frontendOrigin+"/transaction?id=invalid");await page.getByRole("heading",{name:"Transaction not found"}).waitFor();
  await page.goto(frontendOrigin+"/transaction?id="+records[1].id);await page.getByText(/budget guard blocked this request before evidence review/).waitFor();assert.equal(await page.locator(".stage-skipped .status").innerText(),"Skipped");
 });
 await outcome("proof commitment, tamper rejection and JSON download",async()=>{
  await page.goto(frontendOrigin+"/transaction?id="+records[0].id);await page.getByRole("button",{name:"Inspect delivery proof"}).click();await page.getByText("Isolated browser commitment fixture",{exact:true}).waitFor();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Download proof JSON"}).click();const saved=await download;const file=join(folder,environment+"-proof.json");await saved.saveAs(file);const proof=JSON.parse(await readFile(file,"utf8"));assert.equal(digest(proof.proof),proof.proofHash);
  proofTampered=true;await page.getByRole("button",{name:"Refresh proof"}).click();await page.getByRole("alert").filter({hasText:"does not match this transaction"}).waitFor();assert.equal(await page.getByRole("button",{name:"Download proof JSON"}).count(),0);proofTampered=false;
 });
 await outcome("real cross-origin wallet authentication and memory-only owner authority",async()=>{
  await page.goto(frontendOrigin+"/agents");await page.getByRole("heading",{name:"Your wallet is the owner."}).waitFor();await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();await page.getByRole("heading",{name:policy.name,exact:true}).first().waitFor();
  assert.ok(requests.some(r=>r.path==="/owner/cards"&&r.authorization?.startsWith("Owner ")));
  assert.deepEqual(await context.cookies(),[]);assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/session|token|api.?key/i.test(k))),false);
  await page.reload();await page.getByRole("heading",{name:"Your wallet is the owner."}).waitFor();await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();await page.getByRole("heading",{name:policy.name,exact:true}).first().waitFor();
 });
 await outcome("owner replacement acknowledgement and versioned settlement choices",async()=>{
  await page.getByRole("tab",{name:"Policy",exact:true}).click();
  await page.getByRole("button",{name:"Prepare owner replacement"}).click();const dialog=page.getByRole("dialog",{name:"Create a replacement vault"});await dialog.waitFor();await dialog.getByLabel(/I understand that the new vault resets/).waitFor();assert.equal(await dialog.getByRole("button",{name:"Create policy-copy draft"}).isDisabled(),true);
  const routes=dialog.locator("#destinationChainIds input");assert.equal(await routes.count(),Object.keys(networks).length);
  if(mainnet){await dialog.locator("#settlement-asset").selectOption("USDT0");assert.equal(await routes.count(),1);await dialog.locator("#settlement-asset").selectOption("USDC");}else assert.equal(await dialog.locator('option[value="USDT0"]').isDisabled(),true);
  await dialog.getByLabel(/I understand that the new vault resets/).check();await dialog.getByRole("button",{name:"Create policy-copy draft"}).click();await dialog.getByText("Replacement draft created. No funds moved.",{exact:true}).waitFor();assert.deepEqual(lastReplacement,{settlement:{version:2,paymentEnvironment:environment,asset:"USDC",destinationChainIds:[chainId]},acknowledgeAccountingReset:true});await page.keyboard.press("Escape");
 });
 await outcome("funding calldata uses the verified source token and exact amount",async()=>{
  await page.getByRole("tab",{name:"Overview",exact:true}).click();
  await page.getByRole("button",{name:"Fund vault",exact:true}).click();await page.getByLabel("Amount · USDC").fill("1.000001");await page.getByRole("button",{name:"Confirm fund"}).click();await page.getByRole("alert").filter({hasText:/Wallet request declined/}).waitFor();
  const tx=await page.evaluate(()=>(window as unknown as {browserTransactions:{to:string;data:`0x${string}`}[]}).browserTransactions.at(-1));assert.ok(tx);assert.equal(tx.to.toLowerCase(),sourceCard.token);const decoded=decodeFunctionData({abi:parseAbi(["function transfer(address,uint256) returns (bool)"]),data:tx.data});assert.equal(String(decoded.args![0]).toLowerCase(),card.address.toLowerCase());assert.equal(decoded.args![1],1000001n);await page.keyboard.press("Escape");
 });
 await outcome("signout and account-change races clear owner data",async()=>{
  await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByRole("heading",{name:"Your wallet is the owner."}).waitFor();await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));assert.ok(requests.filter(r=>r.path==="/auth/logout").at(-1)?.authorization?.startsWith("Owner "),"Signout must revoke the durable owner token");
  await page.evaluate(()=>{(window as unknown as {deferBrowserSignature:boolean}).deferBrowserSignature=true;});await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();await page.waitForFunction(()=>typeof(window as unknown as {resolveBrowserSignature?:unknown}).resolveBrowserSignature==="function");
  await page.evaluate(()=>{const w=window as unknown as {browserAccounts:string[];browserListeners:Record<string,(a:string[])=>void>;resolveBrowserSignature:()=>void};w.browserAccounts=["0x"+"12".repeat(20)];w.browserListeners.accountsChanged(w.browserAccounts);w.resolveBrowserSignature();});await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));assert.equal(await page.getByRole("heading",{name:policy.name,exact:true}).count(),0);assert.equal(requests.at(-1)?.authorization,null);
 });
 await outcome("downloaded card usage and separate frontend share origin",async()=>{
  await page.goto(frontendOrigin+"/explorer?agentId="+card._id);const download=page.waitForEvent("download");await page.getByRole("button",{name:"Download card",exact:true}).first().click();const saved=await download;const file=join(folder,environment+"-card.svg");await saved.saveAs(file);assert.match(await readFile(file,"utf8"),/5 requests.*4\.000004 USDC/);
  downloadError=true;await page.getByRole("button",{name:"Download card",exact:true}).first().click();await page.getByRole("alert").filter({hasText:"Card service is temporarily unavailable."}).waitFor();downloadError=false;
 });
 await outcome("sectioned documentation, mobile layout and story media",async()=>{
  await page.goto(frontendOrigin+"/docs");await page.getByRole("heading",{name:"Quickstart",exact:true}).first().waitFor();assert.ok(await page.locator(".docs-toc a").count()>=20);
  await page.goto(frontendOrigin+"/docs/policy-fields");await page.getByRole("heading",{name:"Complete policy reference",exact:true}).first().waitFor();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await noOverflow(page);}
  await page.goto(frontendOrigin+"/why-we-exist");await page.getByRole("heading").first().waitFor();await page.emulateMedia({reducedMotion:"reduce"});await page.waitForTimeout(400);await noOverflow(page);await page.screenshot({path:join(folder,environment+"-story-reduced.png")});
  await page.goto(frontendOrigin);await page.waitForFunction(()=>document.querySelector("video")?.paused===true);assert.equal(await page.getByRole("button",{name:"Pause background animation"}).count(),0);await page.emulateMedia({reducedMotion:"no-preference"});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(folder,environment+"-landing.png"),fullPage:true});
  assert.ok([...paths.keys()].some(p=>p.endsWith("protocol-story.mp4")));assert.ok([...paths.keys()].some(p=>p.endsWith("agent-card.mp4")));
 });
 await outcome("unverified or mismatched API cannot authorize owner work",async()=>{
  configMismatch=true;await page.goto(frontendOrigin+"/agents");await page.getByRole("alert").filter({hasText:"inconsistent payment environment"}).waitFor();assert.equal(await page.getByRole("heading",{name:policy.name,exact:true}).count(),0);configMismatch=false;
  unverified=true;await page.reload();await page.getByRole("heading",{name:"Your wallet is the owner."}).waitFor();await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();await page.getByRole("alert").filter({hasText:"not ready for owner actions"}).waitFor();assert.equal(await page.getByRole("heading",{name:policy.name,exact:true}).count(),0);unverified=false;
 });
 assert.deepEqual(errors,[]);
 await writeFile(join(folder,environment+"-browser-report.json"),JSON.stringify({version:1,status:"FRONTEND_BROWSER_VERIFIED",mode:"STATIC_FRONTEND_WITH_ISOLATED_HTTPS_API_AND_REAL_AUTH",paymentEnvironment:environment,sourceCommit,bundleSha256:built.manifest.bundle.directorySha256,checks,pageErrors:errors,livePaymentEvidence:false},null,2));
 console.log("FRONTEND_BROWSER_VERIFIED "+environment+" "+checks.length);
}catch(error){for(const context of browser?.contexts()??[])for(const page of context.pages())console.error("BROWSER_DIAGNOSTIC",JSON.stringify({url:page.url(),alerts:await page.getByRole("alert").allTextContents(),dialogs:(await page.getByRole("dialog").allTextContents()).map(s=>s.slice(0,1200))}));throw error;}
finally{await browser?.close();await close(apiServer);await close(frontendServer);await rm(temporary,{recursive:true,force:true});}
