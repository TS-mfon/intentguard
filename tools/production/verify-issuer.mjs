import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
assert.equal(Number(process.versions.node.split(".")[0]),24,"Node24 is the reviewed toolchain");
// Focused fixtures validate candidate data and a fully mocked RPC. No live
// verification, funded wallet, environment secret or activation is required.
const result=spawnSync(process.execPath,["--import","tsx","--test","--test-reporter=spec","packages/shared/payment-profiles.test.ts"],{cwd:root,encoding:"utf8",timeout:60000,maxBuffer:4*1024*1024});
assert.equal(result.error,undefined,"Issuer test runner unavailable");
if(result.status!==0){process.stderr.write((result.stderr??"")+(result.stdout??""));throw Error("Issuer tooling regressions failed");}
const output=result.stdout;
const summary=output.match(/tests (\d+)/);
assert.ok(summary,"No issuer regression test summary");
for(const field of ["fail","cancelled","skipped","todo"])assert.match(output,new RegExp(field+" 0(?:\\s|$)"),"Issuer tests must all execute successfully: "+field);
const required=[
 "fixed candidate profiles include only source plus ten approved destinations",
 "environment selection rejects foreign chains and USDT0 testnet or CCTP authority",
 "current good state validates all22 independent domain pairs",
 "wrong chain token metadata domain paused state and fee cannot become verified",
 "remote domain token messenger omissions and duplicate rows are rejected",
 "missing and unresolved delegatecall proxy code fails closed",
 "issuer evidence checks the exact network table row rather than loose address presence",
 "USDT0 issuer evidence binds native mainnet token and refuses synthetic or testnet rows",
 "read-only probe uses pinned blocks and reorgs or mismatched RPC identity fail",
 "infrastructure registry matches independent issuer deployment literals",
 "legacy destination fee interfaces do not imply source fee exemption",
 "unbound or malformed implementation proof cannot disguise a delegatecall proxy",
 "issuer rows and native token entries cannot contain ambiguous duplicates",
 "empty pause fields malformed quotas and zero block identities fail closed",
 "beacon proofs must bind the actual returned implementation and agree with other slots",
 "arbitrary map-shaped bytecode tails and unresolved nested proxies remain unsupported",
 "RPC transport denies writes before dispatch and malformed response envelopes never become state"
];
for(const name of required)assert.ok(output.includes("✔ "+name),"Missing decisive issuer regression: "+name);
assert.ok(Number(summary[1])>=required.length,"Missing issuer cases");
console.log(JSON.stringify({scope:"candidate-issuer-registry-and-read-only-tooling",tests:Number(summary[1]),paymentEnvironments:["testnet","mainnet"],destinationsPerEnvironment:10,enabledRoutes:0,liveIssuerAcceptance:"required-before-activation",deployment:"not-broadcast"}));
console.log("ISSUER_TOOLING_VERIFIED");
