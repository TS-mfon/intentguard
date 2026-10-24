import {chromium,type Page} from "@playwright/test";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {card,policy,input,owner,FakeEvm} from "../tests/fixtures";
import {digest} from "../packages/shared";
const port=await new Promise<number>(resolve=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(()=>resolve(typeof a==="object"&&a?a.port:3999))})});
await readFile(new URL("../apps/web/.next/BUILD_ID",import.meta.url),"utf8");
const server=spawn("pnpm",["--filter","@intentguard/web","start","--port",String(port)],{cwd:new URL("../",import.meta.url),stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32",env:{...process.env,APP_URL:"http://127.0.0.1:"+port}});
let output="";server.stdout.on("data",c=>{output+=c.toString()});server.stderr.on("data",c=>{output+=c.toString()});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const folder=new URL("../.local/screenshots/",import.meta.url);await mkdir(folder,{recursive:true});
const errors:string[]=[];
async function noOverflow(page:Page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Viewport has horizontal overflow")}
try{
 const base="http://127.0.0.1:"+port;const readyUntil=Date.now()+60000;
 while(Date.now()<readyUntil){if(await fetch(base).then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,500))}
 if(!await fetch(base).then(r=>r.ok).catch(()=>false))throw Error("Production server did not start: "+output.slice(-3000));
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on("pageerror",e=>errors.push(e.message));await page.goto(base);await page.getByRole("heading",{name:"A card for the mission."}).waitFor();
 await page.getByText("SAMPLE PREVIEW",{exact:true}).waitFor();await noOverflow(page);
 assert.equal(await page.getByRole("button",{name:"Create card",exact:true}).isDisabled(),true);
 const config=await (await fetch(base+"/api/v1/config")).json();assert.equal(config.configured,false);
 await page.screenshot({path:new URL("desktop.png",folder).pathname,fullPage:true});
 await page.getByRole("tab",{name:/Payment ledger/}).click();await page.getByRole("button",{name:"Q4 energy sector outlook",exact:true}).click();await page.getByRole("dialog").waitFor();await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"hidden"});
 for(const width of [768,390]){await page.setViewportSize({width,height:900});await noOverflow(page);await page.getByRole("tab",{name:/Cards/}).click();await page.screenshot({path:new URL("viewport-"+width+".png",folder).pathname,fullPage:true});}
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript({content:`
 window.testWalletMethods=[];
 Object.defineProperty(window,"ethereum",{value:{request:async({method})=>{
 window.testWalletMethods.push(method);
 if(["eth_accounts","eth_requestAccounts"].includes(method))return [${JSON.stringify(owner)}];
 if(method==="eth_chainId")return "0x7a69";
 throw Object.assign(new Error("Wallet request declined"),{code:4001});
 }}});
 `});
 const live=await context.newPage();live.on("pageerror",e=>errors.push(e.message));let cardsVisible=false,guidance:unknown;
 const view={...await new FakeEvm().view(card),keyStatus:"NONE"};const requests=[{id:"0x"+"aa".repeat(32),cardId:card._id,cardName:policy.name,status:"PAID",request:input,requestHash:"0x"+"bb".repeat(32),evidenceHash:"0x"+"cc".repeat(32),createdAt:Date.now(),updatedAt:Date.now()}];
 await live.route("**/api/v1/**",async route=>{const request=route.request(),path=new URL(request.url()).pathname.replace("/api/v1","");let data:unknown={},status=200;
 if(path==="/config")data={mode:"local",chainId:31337,token:String(card.token),factoryAddress:"0x"+"55".repeat(20),configured:true,explorerUrl:"",genLayerExplorerUrl:"https://explorer-studio.genlayer.com"};
 else if(path==="/auth/session")data={address:owner};
 else if(path==="/owner/cards")data={cards:cardsVisible?[view]:[]};
 else if(path==="/owner/requests")data={requests:cardsVisible?requests:[]};
 else if(path==="/owner/drafts"&&request.method()==="POST"){const body=request.postDataJSON();guidance=body.guidance;assert.ok(body.description.length>=10);status=202;data={id:card._id,status:"QUEUED"}}
 else if(path==="/owner/drafts/"+card._id)data={id:card._id,state:"FINALIZED",status:"PROPOSED",policy,interpretation:"Exact research permission",questions:[],activation:{factoryAddress:"0x"+"55".repeat(20),config:{owner,gateway:owner,attestor:owner,token:String(card.token),processor:card.address,circuitId:"1",beacon:card.address,expectedImplementation:card.address,expectedNetlistHash:"0x"+"00".repeat(32),policyHash:digest(policy),totalLimit:"100000000",perPaymentLimit:"10000000",periodLimit:"30000000",periodSeconds:"86400",validFrom:"1",validUntil:"4102444800",allowedRecipients:[input.recipient]}}};
 else if(path.endsWith("/keys")&&request.method()==="POST")data={apiKey:"ig_browser_test_once_only"};
 else if(path.endsWith("/keys")&&request.method()==="DELETE"){await route.fulfill({status:204});return}
 else{status=404;data={error:{code:"NOT_FOUND",message:"Test endpoint unavailable"}}}
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
 });
 await live.goto(base);await live.getByRole("button",{name:"Create card",exact:true}).waitFor();await live.getByRole("button",{name:"Create card",exact:true}).click();await live.getByRole("dialog").waitFor();
 assert.equal(await live.locator("#name").evaluate(el=>el===document.activeElement),true,"Wizard initial focus is not on agent name");
 await live.getByLabel("Agent / card name").fill("Research Agent");await live.getByLabel("Mission",{exact:true}).fill(policy.mission);await live.getByLabel("Task context",{exact:true}).fill(policy.taskContext);await live.getByLabel("Allowed purchase categories").fill("data");await live.getByRole("button",{name:"Continue",exact:true}).click();
 await live.getByLabel("Lifetime budget · USDT").fill("100");await live.getByLabel("Per-payment limit · USDT").fill("10.000001");await live.getByLabel("Period budget · USDT").fill("30");await live.getByRole("button",{name:"Continue",exact:true}).click();
 await live.getByLabel("Merchant name",{exact:true}).fill("Research vendor");await live.getByLabel("Recipient address",{exact:true}).fill(input.recipient);await live.getByLabel("Merchant HTTPS origins").fill("https://merchant.example");await live.getByLabel("Permitted products").fill("Research data");await live.getByLabel("Approved evidence origins").fill("https://merchant.example");await live.getByRole("button",{name:"Propose terms",exact:true}).click();
 await live.getByText("Approve the exact terms.",{exact:true}).waitFor({timeout:15000});assert.equal(Object.keys(guidance as object).length,11);
 await live.getByRole("checkbox").check();await live.getByRole("button",{name:"Activate card",exact:true}).click();await live.getByText(/Wallet request declined/).waitFor();assert.equal(await live.getByRole("dialog").isVisible(),true,"Declined activation lost the form");
 await live.keyboard.press("Escape");cardsVisible=true;await live.reload();await live.getByRole("tab",{name:/Agent API/}).click();await live.getByRole("button",{name:"Issue API key",exact:true}).click();await live.getByRole("dialog").waitFor();await live.getByText("ig_browser_test_once_only",{exact:true}).waitFor();await live.getByRole("button",{name:/saved the key/}).click();
 assert.equal(await live.getByText("ig_browser_test_once_only",{exact:true}).count(),0);
 assert.equal(await live.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes("ig_browser_test_once_only")),false);
 await live.getByRole("tab",{name:/Payment ledger/}).click();await live.getByRole("combobox",{name:"Filter requests by status"}).selectOption("PAID");await live.getByRole("button",{name:"Verified protocol data API",exact:true}).waitFor();
 assert.deepEqual(errors,[]);await writeFile(new URL("browser-report.json",folder),JSON.stringify({mode:"PRODUCTION_BROWSER_WITH_EXPLICIT_TEST_API",viewports:[1440,768,390],pageErrors:errors,checks:["sample write disabled","responsive overflow","dialog keyboard","complete guidance","declined activation preservation","one-time key storage","ledger filters"]},null,2));
 console.log("PRODUCTION_BROWSER_FLOWS_PASSED");
}catch(error){for(const context of browser?.contexts()??[]){for(const page of context.pages()){console.error("BROWSER_DIAGNOSTIC",JSON.stringify({url:page.url(),alerts:await page.getByRole("alert").allTextContents(),dialogs:await page.getByRole("dialog").allTextContents(),walletMethods:await page.evaluate(()=>((window as unknown as {testWalletMethods?:string[]}).testWalletMethods??[]))}));}}throw error;}finally{await browser?.close();if(process.platform==="win32")server.kill("SIGTERM");else if(server.pid){try{process.kill(-server.pid,"SIGTERM")}catch{server.kill("SIGTERM")}}}
