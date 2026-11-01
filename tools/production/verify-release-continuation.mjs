import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {ROOT} from "../hosting/protocol.mjs";

assert.equal(process.version,"v24.18.0","Use the reviewed Node24.18.0 toolchain");
for(const [script,marker]of [["verify-mainnet-deploy.mjs","MAINNET_DEPLOYMENT_TOOLING_VERIFIED"],["verify-hosting.mjs","HOSTING_TOOLING_VERIFIED"]]){
 const result=spawnSync(process.execPath,["tools/production/"+script],{cwd:ROOT,encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024}),output=(result.stdout??"")+(result.stderr??"");
 if(result.error||result.status!==0){process.stderr.write(output);throw result.error??Error("Release continuation check failed: "+script);}assert.ok(output.includes(marker));
}
const result=spawnSync(process.execPath,["--test","--test-reporter=tap","tests/release-live.test.mjs"],{cwd:ROOT,encoding:"utf8",timeout:90000,maxBuffer:8*1024*1024}),output=(result.stdout??"")+(result.stderr??"");
if(result.error||result.status!==0){process.stderr.write(output);throw result.error??Error("Independent live-verifier regressions failed");}
const tests=Number(output.match(/^# tests (\d+)$/m)?.[1]);assert.ok(tests>=12);assert.match(output,new RegExp("^# pass "+tests+"$","m"));for(const status of ["fail","cancelled","skipped","todo"])assert.match(output,new RegExp("^# "+status+" 0$","m"));
for(const name of ["live CPU verifies fresh official identities and all 490 numerical vectors against an independent NAND control","live runtime accepts actual available assets and binds both factories processor and every destination","local USDC USDT0 and all ten bridge canaries bind delivered requests to verified current factory vaults","registry verification enumerates every path and rejects extra files incomplete chunks or altered bytes","hosting integration requires current registry activation source and fresh reviewed actual owner traces"])assert.ok(output.includes(" - "+name),"Required continuation regression missing: "+name);
const doc=await readFile(new URL("../../docs/production/INFRASTRUCTURE-CONTINUATION.md",import.meta.url),"utf8");for(const required of ["1952","196","Studionet","cap","source","72","gateway-api-access","vaultStageKey","spending","live-manifest"])assert.ok(doc.includes(required),"Missing continuation requirement: "+required);
console.log(JSON.stringify({scope:"local deployment, receipt, circuit, canary and publication verification tooling",liveVerifierTests:tests,actualCPURegistrations:0,actualDeWEBPublications:0,actualLiveRounds:0,spendingAuthorized:false}));
console.log("RELEASE_CONTINUATION_VERIFIED");
