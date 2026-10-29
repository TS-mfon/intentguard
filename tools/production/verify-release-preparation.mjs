import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {ROOT, OUTPUTS, rawJson, captureSource, validatePreparation, validateQuote, collectCompiled} from "./release-plan.mjs";

assert.equal(process.version,"v24.18.0","Use reviewed Node v24.18.0");
const result=spawnSync(process.execPath,["--test","--test-reporter=tap","tests/release-preparation.test.mjs"],{cwd:ROOT,encoding:"utf8",timeout:90000,maxBuffer:4*1024*1024});
if(result.error||result.status!==0) { process.stderr.write((result.stdout??"")+(result.stderr??"")); throw result.error??Error("Release preparation regression failed"); }
const output=result.stdout; for(const field of ["fail","cancelled","skipped","todo"])assert.match(output,new RegExp(`^# ${field} 0$`,"m"),"Every release regression must execute");
const tests=Number(output.match(/^# tests (\d+)$/m)?.[1]); assert.ok(tests>=16,"Missing release regressions");
const preparation=await rawJson(resolve(ROOT,OUTPUTS[0])); const quote=await rawJson(resolve(ROOT,OUTPUTS[1]));
const source=await captureSource(); const build=await collectCompiled();
validatePreparation(preparation,{currentSource:source,compiled:build,final:process.argv.includes("--final")});
validateQuote(quote,{source,build,preparation});
console.log(JSON.stringify({scope:"source-bound-read-only-release-preparation",tests,sourceCommit:source.commit,sourceDirty:source.sourceDirty,contracts:build.contracts.map(({name,creationBytes,runtimeBytes})=>({name,creationBytes,runtimeBytes})),quoteStatus:quote.status,quoteExpired:Date.now()>=Date.parse(quote.expiresAt),knownFeesWei:quote.economics.knownFeesWei,estimatedGasCostWei:quote.economics.estimatedGasCostWei,unresolvedCosts:quote.costs.filter(c=>c.estimatedGas===null).map(c=>c.id),spendingEnabled:false,signatures:0,broadcasts:0}));
console.log("RELEASE_PREPARATION_VERIFIED");
