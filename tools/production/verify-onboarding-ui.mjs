import {spawn} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../.."),env={PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:"1",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
async function run(command,args,marker){let output="";await new Promise((done,fail)=>{const child=spawn(command,args,{cwd:root,env,stdio:["ignore","pipe","pipe"]});const consume=chunk=>{const text=chunk.toString();output+=text;process.stdout.write(text);};child.stdout.on("data",consume);child.stderr.on("data",consume);child.once("error",fail);child.once("exit",code=>code===0?done():fail(Error("UI verification failed: "+command+" "+code)));});if(marker&&!output.includes(marker))throw Error("Missing successful UI check: "+marker);return output;}
const unit=await run("pnpm",["exec","tsx","--test","tests/agent-templates.test.ts","tests/setup-form.test.ts"]);
const stat=name=>Number(unit.match(new RegExp("(?:ℹ |# )"+name+" (\\d+)"))?.[1]??-1);
if(stat("pass")<11||stat("pass")!==stat("tests")||["fail","cancelled","skipped","todo"].some(name=>stat(name)!==0))throw Error("Template/form coverage is missing or failing");
await run("pnpm",["typecheck"]);
for(const environment of ["testnet","mainnet"]){
 await run(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/onboarding-browser.ts","--environment="+environment],"ONBOARDING_BROWSER_VERIFIED "+environment);
 const report=JSON.parse(await readFile(resolve(root,".local/production-frontend",environment+"-browser-report.json"),"utf8"));
 if(report.paymentEnvironment!==environment||report.livePaymentEvidence!==false||report.pageErrors.length)throw Error("Invalid browser evidence boundary");
 for(const name of ["complete templates, shared quick/manual forms and failed draft recovery","explicit full-policy acceptance, wallet rejection and confirmed activation recovery","searchable measured card gallery, dedicated detail, back and missing agent"])if(!report.checks.includes(name))throw Error("Required browser flow is missing: "+name);
 if(environment==="testnet"&&(!Number.isSafeInteger(report.onboarding.protocolInAppClicks)||report.onboarding.protocolInAppClicks<1||report.onboarding.protocolInAppClicks>10))throw Error("Runnable template interaction count is absent or exceeds ten");
 const manifest=JSON.parse(await readFile(resolve(root,".local/static-frontend/manifest.json"),"utf8"));
 if(manifest.paymentEnvironment!==environment||manifest.bundle.directorySha256!==report.bundleSha256||manifest.sourceCommit!==report.sourceCommit)throw Error("Onboarding browser does not match its built frontend");
 await writeFile(resolve(root,".local/production-frontend",environment+"-static-manifest.json"),JSON.stringify(manifest,null,2)+"\n");
}
console.log("ONBOARDING_UI_VERIFIED");
