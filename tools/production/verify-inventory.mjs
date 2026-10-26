import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const archive=readFileSync("docs/reviews/2026-10-26-original-feedback.md");
const metadata=JSON.parse(readFileSync("docs/reviews/2026-10-26-provenance.json","utf8"));
assert.equal(createHash("sha256").update(archive).digest("hex"),"e66b5383ad6aa6a56500e1ea9710e01da9a4ffc4d9949e9494e47bfa727856bf");
assert.equal(metadata.sha256,createHash("sha256").update(archive).digest("hex"));
assert.equal(metadata.utf8Bytes,archive.length);
for(const heading of ["Hostile final judge memo","Corrected final judge verdict","CLOSE UNLESS FIXED","Docker image builds the web app but starts the worker"])assert.ok(archive.toString().includes(heading),heading);
const plan=readFileSync("docs/production/REMEDIATION-PLAN.md","utf8");
const register=JSON.parse(readFileSync("docs/production/findings.json","utf8"));
assert.deepEqual(register.findings.map(f=>f.id),Array.from({length:27},(_,i)=>"R"+String(i+1).padStart(2,"0")));
for(const f of register.findings){assert.ok(plan.includes("| "+f.id+" |"));assert.ok(f.acceptance&&f.ownerLeaf&&f.observingGate);assert.ok(["OPEN","CONFIRMED","PARTIAL","VERIFIED","HISTORICAL","UNVERIFIED","HANDOFF"].includes(f.status));}
assert.equal(register.decisions.testnetPreserved,true);
assert.equal(register.decisions.reviewEnvironment,"testnet");
assert.equal(register.decisions.executor,"github-actions");
assert.equal(register.decisions.costPolicy,"quote-before-spending");
assert.equal(register.decisions.cctpDestinationChainIds.length,10);
console.log("REVIEW_INVENTORY_VERIFIED");
