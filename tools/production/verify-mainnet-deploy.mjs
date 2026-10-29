import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {ROOT} from "../hosting/protocol.mjs";

assert.equal(process.version,"v24.18.0","Use the reviewed Node24.18.0 toolchain");
const result=spawnSync(process.execPath,["--test","--test-reporter=tap","tests/mainnet-deploy.test.mjs"],{cwd:ROOT,encoding:"utf8",timeout:120000,maxBuffer:4*1024*1024});
if(result.error||result.status!==0){process.stderr.write((result.stdout??"")+(result.stderr??""));throw result.error??Error("Deployment tooling regression failed");}
const output=result.stdout;const tests=Number(output.match(/^# tests (\d+)$/m)?.[1]);assert.ok(tests>=50,"Deployment scope, recovery and receipt regressions missing");for(const field of ["fail","cancelled","skipped","todo"])assert.match(output,new RegExp(`^# ${field} 0$`,"m"),"Every deployment regression must execute");
const doc=await readFile(new URL("../../docs/production/MAINNET-DEPLOYMENT.md",import.meta.url),"utf8");for(const required of ["source","cap","Studionet","opener","transistor","DeWEB","reconcile","transferCircuit"])assert.ok(doc.includes(required),"Deployment stage disclosure missing: "+required);
console.log(JSON.stringify({scope:"staged-deployment-tooling",tests,actualMainnetDeployments:0,paidProvisioning:0,spendingAuthorized:false,liveAcceptance:false,sourceCommitRequirement:"clean exact HEAD",quoteLifetimeSeconds:300,receiptConfirmations:2}));
console.log("MAINNET_DEPLOYMENT_TOOLING_VERIFIED");
