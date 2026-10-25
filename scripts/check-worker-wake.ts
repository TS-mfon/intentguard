import {spawnSync} from "node:child_process";
const result=spawnSync("pnpm",["test"],{stdio:"inherit"});
if(result.status!==0)process.exit(result.status??1);
console.log("WORKER_WAKE_TESTS_PASSED");
