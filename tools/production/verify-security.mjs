import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
export const requiredAttacks=[
 "S06 intermediate progress cannot reset the thirty-minute pre-burn deadline",
 "a deadline crossed during finality is checked again before attesting",
  "S01 copied testnet wallet challenge cannot authorize a mainnet session",
  "S02 revocation during the last finality read cancels rather than settles",
  "S03 reserved IPv6 addresses cannot bypass checks through expanded or zero-padded notation",
  "rotation, explicit cancellation and late expiry interrupt final approval",
  "changed final commitments and lost leases never reach the signer",
  "valid final approval continues to settle once after the new rechecks",
  "S04 byte trickle cannot extend the absolute evidence deadline",
  "absolute deadline also bounds DNS and never connects after late resolution",
  "public complete UTF-8 evidence succeeds within the absolute deadline",
  "compression, declared excess size, redirects, invalid UTF-8 and abrupt close are rejected",
  "mixed public and private DNS answers fail before transport",
  "S05 an unrelated successful journal receipt cannot establish PAID",
  "exact Paid and token Transfer events establish the direct-payment receipt",
  "wrong token, vault, recipient, amount, decision, duplicate transfer and insufficient confirmation cannot establish payment",
  "recovered GenLayer journal must match current call intent even with a cached protocol hash",
  "correct GenLayer raw intent returns the cached protocol result without broadcast",
  "saved GenLayer EVM hash must equal the signed transaction hash",
  "replacement details require the owning session and disclose pending work and accounting reset",
  "explicit owner replacement copies policy once while leaving funds, reviewer and history untouched",
  "replacement refuses missing acknowledgement, cross-origin, extra policy overrides and cross-environment settlement",
  "semantic acceptance never credits cancellation as finalized rejection",
  "a durable admission or approval cannot be counted as a delivered payment",
  "latency thresholds are declared before live execution and fail oversized samples",
  "release acceptance requires ten fresh cases per core group and cannot declare unsafe purchases paid",
  "expired, replaced or missing worker leases cannot broadcast after long RPC waits",
  "complete bridge proof persists source, raw Iris, destination mint and acknowledgement digest through recovery"
];
export function assertSecuritySuite(name,output){
 const stat=key=>{const m=output.match(new RegExp("(?:ℹ |# )"+key+" (\\d+)"));if(!m)throw Error("Missing test summary: "+key);return Number(m[1]);};
 if(name==="application"){
  if(stat("tests")<152||stat("pass")!==stat("tests"))throw Error("Application test count or passes regressed");
  for(const key of ["fail","cancelled","skipped","todo"])if(stat(key)!==0)throw Error("Security verification refuses "+key);
  for(const test of requiredAttacks)if(!output.includes("✔ "+test+" (")&&!new RegExp("ok \\d+ - "+test.replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&")+"(?:\\n|$)").test(output))throw Error("Required attack/control did not pass: "+test);
  return stat("tests");
 }
 const match=output.match(/(\d+) tests passed, 0 failed, 0 skipped/);
 if(!match||Number(match[1])<133)throw Error("Contract security coverage regressed");
 for(const test of ["testFuzzRealTapeOutVMMatchesIndependentArithmetic","testFuzzExactBurnAndAccounting","testEveryReceiptFieldMutationAndWrongAttestorRejected","testIndependentReceiptAndDuplicateAcknowledgement","testPauseStopsReserveAndPreviouslySignedSettlement","testTokenCallbackCannotReenterSettlement"])if(!output.includes("[PASS] "+test))throw Error("Required contract attack/control did not pass: "+test);
 return Number(match[1]);
}
async function main(){
 const suites=[["application","pnpm",["test"]],["contracts",process.execPath,["tools/check.mjs","evm"]]],results=[];
 for(const [name,command,args] of suites){
  const result=spawnSync(command,args,{encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024}),output=(result.stdout??"")+(result.stderr??"");
  if(result.error||result.status!==0){process.stderr.write(output);throw Error("Security verification failed: "+name);}
  const passed=assertSecuritySuite(name,output);results.push({name,passed,outputSha256:createHash("sha256").update(output).digest("hex")});console.log(name+": "+passed+" passed");
 }
 const paths=["apps/web/lib/auth.ts","apps/web/lib/evidence.ts","apps/web/lib/worker.ts","apps/web/lib/evm.ts","apps/web/lib/payment-proof.ts","apps/web/lib/cctp.ts","apps/web/lib/genlayer.ts","apps/web/lib/transaction-profile.ts","apps/web/lib/signing-lease.ts","apps/web/lib/replacement.ts","scripts/audit-production-semantic.ts","docs/security/2026-10-26-adversarial-audit.md",...["tests/settlement-authorization-security.test.ts","tests/processing-deadline-security.test.ts","tests/owner-challenge-security.test.ts","tests/evidence-address-security.test.ts","tests/evidence-security.test.ts","tests/payment-receipts.test.ts","tests/genlayer-journal-security.test.ts","tests/replacement-security.test.ts","tests/semantic-acceptance-security.test.ts","tests/signing-lease-security.test.ts"]],fingerprints={};
 for(const path of paths)fingerprints[path]=createHash("sha256").update(await readFile(path)).digest("hex");
 const report=await readFile("docs/security/2026-10-26-adversarial-audit.md","utf8");
 for(const id of ["S01","S02","S03","S04","S05","S06"])if(!report.includes(id))throw Error("Missing security finding: "+id);
 if(!report.includes("not formal verification")||!report.includes("R12–R17")||!report.includes("not an invisible migration"))throw Error("Security scope/recovery disclosure missing");
 console.log(JSON.stringify({scope:"local application and contract security",generatedAt:new Date().toISOString(),results,fingerprints,liveAcceptance:"unverified"}));console.log("SECURITY_VERIFIED");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
