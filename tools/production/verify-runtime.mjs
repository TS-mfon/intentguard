import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
const files=["tests/capabilities.test.ts","tests/runtime-profile.test.ts","tests/auth-environment.test.ts","tests/database-profile.test.ts","tests/deployment-profile.test.ts","tests/reviewer-profile.test.ts","tests/transaction-profile.test.ts","tests/api.test.ts","tests/cctp-api.test.ts","tests/cctp.test.ts","tests/worker.test.ts","tests/worker-wake.test.ts"];
const result=spawnSync("pnpm",["exec","tsx","--test","--test-reporter=tap",...files],{encoding:"utf8",timeout:180000,maxBuffer:4*1024*1024});
if(result.error||result.status!==0){process.stderr.write(result.stdout??"");process.stderr.write(result.stderr??"");throw result.error??Error("Runtime integration tests failed")}
const output=(result.stdout??"")+"\n"+(result.stderr??"");
const count=Number(output.match(/^# tests (\d+)$/m)?.[1]);
assert(count>=80,"Runtime integration tests missing");
assert.match(output,/^# fail 0$/m);assert.match(output,/^# skipped 0$/m);
console.log("Runtime integration tests: "+count+" passed; 0 failures; 0 skipped.");
console.log("RUNTIME_VERIFIED");
