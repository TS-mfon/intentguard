import assert from "node:assert/strict";import {spawnSync} from "node:child_process";
const r=spawnSync(process.execPath,["--import","tsx","--test","--test-reporter=tap","scripts/production-database.test.ts"],{encoding:"utf8",timeout:60000,maxBuffer:1048576});
if(r.error||r.status!==0){process.stderr.write((r.stdout??"")+(r.stderr??""));throw r.error??Error("Database permission checks failed");}
assert.match(r.stdout,/# tests 8\b/);assert.match(r.stdout,/# fail 0\b/);assert.match(r.stdout,/# skipped 0\b/);
console.log("8 database permission, cluster-cost and encrypted restore tests passed.");console.log("DATABASE_TOOLING_VERIFIED");
