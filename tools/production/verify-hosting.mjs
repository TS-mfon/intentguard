import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
assert.equal(Number(process.versions.node.split(".")[0]),24,"Node24 is the reviewed toolchain");
const root=resolve(import.meta.dirname,"../..");
const result=spawnSync(process.execPath,["--test","--test-reporter=spec","tools/hosting/hosting.test.mjs"],{cwd:root,encoding:"utf8",timeout:60000,maxBuffer:4*1024*1024});
if(result.error||result.status!==0){process.stderr.write((result.stdout??"")+(result.stderr??""));throw Error("Hosting planner checks failed");}
const output=result.stdout;
for(const field of ["fail","cancelled","skipped","todo"])assert.match(output,new RegExp(field+" 0(?:\\s|$)"),"All hosting regressions must run successfully");
const tests=Number(output.match(/tests (\d+)/)?.[1]);assert.equal(tests,13,"Missing hosting regressions");
const required=[
 "metadata decoder literals remain public while encoded source-map payloads are rejected",
 "official TapeKit source and circuit NAND metadata match exact pinned bytes",
 "static bundle positive control has stable per-file hashes chunks MIME and gateway deep links",
 "forbidden paths symlinks NFD source maps and secret literals fail against a valid bundle",
 "public credentials guide is allowed while secret files and payloads remain forbidden",
 "wrong chain mutable circuit beacon code and implementation changes cannot become quotes",
 "expired mutated quotes exact caps and static directory identity cannot bypass plan guards",
 "unknown required fees remain incomplete and provisioning exposes unsimulated dependent stages",
 "resume verifies every existing chunk and refuses duplicate boundary MIME hash and content conflicts",
 "RPC only reads requires independent agreement and rejects wrong chain malformed envelopes and writes",
 "full pinned protocol observation accepts frozen existing CPU and rejects mutable beacon changed code and owner",
 "full resume skips verified partial bytes emits only remaining append indices and rejects changed configuration or bundle",
 "the actual per-file 350 chunk byte limit accepts its boundary and refuses one extra byte"
];
for(const name of required)assert.ok(output.includes("✔ "+name),"Required hosting control did not run: "+name);
console.log(JSON.stringify({scope:"read-only-hosting-quotes-and-resume-planning",tests,chainId:196,signatures:0,broadcasts:0,liveCPU:"R18-pending",livePublication:"R19-pending"}));
console.log("HOSTING_TOOLING_VERIFIED");
