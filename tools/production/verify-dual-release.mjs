import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawn,execFileSync} from "node:child_process";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"../.."),folder=resolve(root,".local/dual-release");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
assert.equal(process.version,"v24.18.0","Use the reviewed Node24.18.0 toolchain");
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
assert.match(sourceCommit,/^[a-f0-9]{40}$/);
assert.equal(execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim(),"","Verify the committed release from a clean checkout");
const checks=[];
async function run(command,args,marker,timeout=180000){
 let output="";
 await new Promise((done,fail)=>{
  const child=spawn(command,args,{cwd:root,env:{PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:"1",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})},stdio:["ignore","pipe","pipe"]});
  const timer=setTimeout(()=>{child.kill("SIGTERM");fail(Error("Integration check timed out: "+args.join(" ")));},timeout);
  const consume=chunk=>{output+=chunk.toString();process.stdout.write(chunk);};
  child.stdout.on("data",consume);child.stderr.on("data",consume);
  child.once("error",error=>{clearTimeout(timer);fail(error);});
  child.once("exit",code=>{clearTimeout(timer);code===0?done():fail(Error("Integration check failed: "+command+" "+args.join(" ")));});
 });
 if(marker)assert.ok(output.includes(marker),"Missing successful check marker: "+marker);
 checks.push({command:[command,...args],outputSha256:sha(output)});
}

// Browser evidence is produced by verify-onboarding-ui.mjs before integration.
// Hash every source input again so a stale build cannot qualify changed code.
const frontends=[];
for(const environment of ["testnet","mainnet"]){
 const manifestBytes=await readFile(resolve(root,".local/production-frontend",environment+"-static-manifest.json"));
 const reportBytes=await readFile(resolve(root,".local/production-frontend",environment+"-browser-report.json"));
 const manifest=JSON.parse(manifestBytes),report=JSON.parse(reportBytes);
 assert.equal(manifest.paymentEnvironment,environment);assert.equal(report.paymentEnvironment,environment);assert.equal(manifest.sourceCommit,sourceCommit,"Rebuild browser evidence for the current committed release");
 assert.equal(report.bundleSha256,manifest.bundle.directorySha256);assert.equal(report.sourceCommit,manifest.sourceCommit);
 assert.equal(report.livePaymentEvidence,false);assert.deepEqual(report.pageErrors,[]);
 assert.equal(manifest.serverRoutesIncluded,false);assert.equal(manifest.reviewChainId,61999);
 assert.equal(sha(JSON.stringify(manifest.sourceInputs)),manifest.sourceTreeSha256);
 for(const[path,expected]of Object.entries(manifest.sourceInputs))assert.equal(sha(await readFile(resolve(root,path))),expected,"Frontend source changed after browser verification: "+path);
 for(const name of ["complete templates, shared quick/manual forms and failed draft recovery","explicit full-policy acceptance, wallet rejection and confirmed activation recovery","searchable measured card gallery, dedicated detail, back and missing agent"])assert.ok(report.checks.includes(name),"Required onboarding behavior is absent: "+name);
 if(environment==="testnet")assert.ok(Number.isSafeInteger(report.onboarding.protocolInAppClicks)&&report.onboarding.protocolInAppClicks>=1&&report.onboarding.protocolInAppClicks<=10);
 frontends.push({paymentEnvironment:environment,sourceCommit,bundleSha256:manifest.bundle.directorySha256,sourceTreeSha256:manifest.sourceTreeSha256,manifestSha256:sha(manifestBytes),browserReportSha256:sha(reportBytes),protocolInAppClicks:report.onboarding.protocolInAppClicks});
}
await run("pnpm",["typecheck"]);
await run(process.execPath,["tools/check.mjs","circuit"],"CIRCUIT_CHECK_PASSED");
await run(process.execPath,["tools/check.mjs","release"],"RELEASE_CHECK_PASSED");
await run("pnpm",["exec","tsx","scripts/verify-protocol-docs.ts"],"Protocol documentation verification passed");
await run(process.execPath,["--test","packages/mcp/test/server.test.mjs"]);
await run(process.execPath,["tools/production/verify-reviewer.mjs"],"REVIEWER_VERIFIED");
await run(process.execPath,["tools/production/verify-workflows.mjs"],"WORKFLOWS_VERIFIED");
await run("pnpm",["build"],undefined,300000);
assert.ok((await readFile(resolve(root,"apps/web/.next/standalone/apps/web/server.js"))).length>0,"Standalone frontend server is absent");
await run("pnpm",["exec","tsx","scripts/identity-browser.ts"],"Identity browser verification passed",300000);
await run("pnpm",["exec","tsx","scripts/agent-card-browser.ts"],"Glossy card browser verification passed",180000);
await mkdir(folder,{recursive:true});
assert.equal(execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),sourceCommit,"Source commit changed during verification");
assert.equal(execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim(),"","Source changed during verification");
await writeFile(resolve(folder,"source-verification.json"),JSON.stringify({version:1,scope:"current committed source integration and isolated frontend browser controls",sourceCommit,sourceDirty:false,verifiedAt:new Date().toISOString(),frontends,checks,actualOfficialRegistration:false,actualDeWEBPublication:false,actualLiveAcceptance:false,actualSustainedAvailability:false},null,2)+"\n");
console.log("DUAL_RELEASE_SOURCE_VERIFIED");
