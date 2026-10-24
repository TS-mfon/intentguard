import {spawnSync} from "node:child_process";
const mode=process.argv[2];
const commands={evm:[["forge",["test","--root","contracts/evm"]]],circuit:[["node",["--test","circuits/policy.test.mjs"]]],genlayer:[["pnpm",["test:genlayer"]]],api:[["pnpm",["test"]]],types:[["pnpm",["typecheck"]]],build:[["pnpm",["build"]]],integration:[["pnpm",["exec","tsx","scripts/integration.ts"]]],browser:[["pnpm",["build"]],["pnpm",["exec","tsx","scripts/browser.ts"]]],release:[["pnpm",["exec","tsx","scripts/release-check.ts"]]]};
if(mode==="all-tests"){for(const sub of ["evm","circuit","genlayer","api"]){const p=spawnSync(process.execPath,[import.meta.filename,sub],{stdio:"inherit"});if(p.status!==0)process.exit(p.status??1)}console.log("ALL-TESTS_CHECK_PASSED");process.exit(0)}
if(!commands[mode])throw Error("Unknown check");
for(const[cmd,args]of commands[mode]){const p=spawnSync(cmd,args,{stdio:"inherit",env:process.env});if(p.status!==0)process.exit(p.status??1)}
console.log(mode.toUpperCase()+"_CHECK_PASSED");
