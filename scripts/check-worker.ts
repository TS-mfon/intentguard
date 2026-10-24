import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const workflow=await readFile(new URL("../.github/workflows/worker.yml",import.meta.url),"utf8");
const runner=await readFile(new URL("../apps/worker/main.ts",import.meta.url),"utf8");
assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/cron: "\*\/5 \* \* \* \*"/);
assert.match(workflow,/group: intentguard-worker\n  cancel-in-progress: false/);
assert.match(workflow,/timeout-minutes: 8/);assert.match(workflow,/contents: read/);
assert.match(workflow,/node-version: "24"/);assert.match(workflow,/version: 11\.9\.0/);
assert.match(workflow,/pnpm install --frozen-lockfile/);
assert.match(workflow,/pnpm exec tsx apps\/worker\/main\.ts --duration-seconds "\$WORKER_RUN_SECONDS"/);
for(const name of ["MONGODB_URI","XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY","GENLAYER_OPERATOR_PRIVATE_KEY"]){
 assert.ok(workflow.includes(name+": ${{ secrets."+name+" }}"),name+" must be an Actions secret");
 assert.ok(!workflow.includes(name+": ${{ vars."),name+" must never be a repository variable");
}
for(const name of ["INTENTGUARD_MODE","XLAYER_CHAIN_ID","XLAYER_RPC_URL","PAYMENT_TOKEN","CARD_FACTORY_ADDRESS","GATEWAY_ADDRESS","ATTESTOR_ADDRESS","TAPEOUT_PROCESSOR","TAPEOUT_CIRCUIT_ID","TAPEOUT_BEACON","TAPEOUT_IMPLEMENTATION","TAPEOUT_NETLIST_HASH","GENLAYER_INTERPRETER_ADDRESS","GENLAYER_RPC_URL","MONGODB_DB","APP_URL"]){
 assert.ok(workflow.includes(name+": ${{ vars."+name+" }}"),name+" configuration missing");
}
assert.ok(workflow.includes('if [[ "$INTENTGUARD_MODE" != "testnet" || "$XLAYER_CHAIN_ID" != "1952" ]]'),"Scheduled signing must be testnet-only");
assert.match(runner,/workerDuration\(process\.argv\.slice\(2\)/);assert.match(runner,/runWorker\(\(\)=>worker\.tick\(\)/);
assert.match(runner,/process\.once\("SIGTERM"/);assert.match(runner,/process\.exit\(1\)/);
console.log("ACTIONS_WORKER_CHECK_PASSED");
