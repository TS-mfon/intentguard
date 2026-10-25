import {spawnSync} from "node:child_process";
const result=spawnSync("pnpm",["exec","tsx","--test","tests/worker-wake.test.ts","tests/api.test.ts","tests/worker-runner.test.ts"],{stdio:"inherit"});
if(result.status!==0)process.exit(result.status??1);
console.log("WORKER_WAKE_TESTS_PASSED");
