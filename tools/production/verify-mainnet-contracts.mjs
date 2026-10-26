import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const usdt0Only = process.argv.includes("--usdt0");
function run(command, args) {
  const p = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(p.error, undefined, `${command} could not run: ${p.error?.message}`);
  assert.equal(p.status, 0, `${command} failed: ${p.stderr}\n${p.stdout}`);
  return p.stdout;
}
const baseline = "63ecc771b3313419f6df7f483e1b2964024570a6";
for (const file of ["CctpSpendingCard.sol", "CctpCardFactory.sol", "AgentSpendingCard.sol", "CardFactory.sol"]) {
  const path = `contracts/evm/src/${file}`;
  const prior = run("git", ["show", `${baseline}:${path}`]);
  const current = readFileSync(resolve(root,path));
  assert.equal(createHash("sha256").update(current).digest("hex"),
    createHash("sha256").update(prior).digest("hex"), `Legacy contract changed: ${path}`);
}
const args = ["test", "--root", "contracts/evm", "--json"];
if (usdt0Only) args.push("--match-contract", "MainnetUsdt0FactoryTest");
const results = JSON.parse(run("forge",args));
let tests = 0;
for (const [suite, value] of Object.entries(results)) {
  const outcomes = Object.values(value.test_results);
  for (const outcome of outcomes) {
    assert.equal(outcome.status,"Success",`Nonpassing contract test in ${suite}`);
    tests++;
  }
}
assert.ok(tests > 0,"No contract tests ran");
const requiredV4 = [
  "testSourceAndFactoryIdentityPinned()", "testEveryDestinationMatchesIndependentIssuerTable()",
  "testFactoryCreationCodeStoresAreFixedAndDeployable()", "testFactoryRejectsTamperedCreationCodeStore()",
  "testAllTenCrossChainRoutesBurnExactAmountAndNoLocalPaymentEvent()",
  "testSourceLocalSettlementUsesV4SignatureAndExactCredit()", "testWrongLocalTokenCreditRollsBackPaidAndLedger()",
  "testFactoryRejectsForgedOwnerAndChangedChain()", "testConstructorRejectsOtherEnvironmentAsset()",
  "testRouteSubsetAndLocalPermissionCannotBeBypassed()", "testEveryCommitmentMutationAndLegacyDomainCannotBurn()",
  "testEveryReceiptFieldMutationAndWrongAttestorRejected()", "testSignaturesCannotReplayAcrossCardsOrRequests()",
  "testNoReceiptBeforeBurnAndNoCancellationOrExpiryAfterBurn()", "testFeeChangeAndTokenPauseDoNotConsumeReservation()",
  "testInfrastructureRelationshipsPausesAndRemoteMappingFailClosed()",
  "testInfrastructureAndTokenRuntimeCodeChangesFailClosed()", "testBurnFailureDebitAndApprovalRollBackEntireSettlement()",
  "testIssuerAndTokenCallbacksCannotReenterSettlementOrReceipt()", "testBudgetsAndWithdrawalAcrossPeriodsIncludeBurnedFunds()",
  "testFuzzExactBurnAndAccounting(uint64,uint8)"
];
const requiredUsdt0 = [
  "testOnlyOfficialMainnetAssetCreatesStandardLocalCard()", "testTestnetFactoryAndCreationRefuse()",
  "testDifferentTokenAndForgedOwnerReject()", "testMissingIssuerCodeRejects()", "testChangedIssuerCodeAndDecimalsRefuseNewCard()"
];
for (const name of usdt0Only ? ["MainnetUsdt0FactoryTest"] : ["CctpV4MainnetTest","CctpV4TestnetTest","MainnetUsdt0FactoryTest"]) {
  const match = Object.entries(results).find(([suite]) => suite.endsWith(`:${name}`));
  assert.ok(match,`Missing required suite ${name}`);
  for (const test of name === "MainnetUsdt0FactoryTest" ? requiredUsdt0 : requiredV4)
    assert.equal(match[1].test_results[test]?.status,"Success",`Missing decisive test ${name}.${test}`);
}
const contracts = usdt0Only ? ["MainnetUsdt0CardFactory"] : ["CctpSpendingCardV4","CctpCardFactoryV4","MainnetUsdt0CardFactory"];
const sizes = {};
for (const name of contracts) {
  const artifact = JSON.parse(readFileSync(resolve(root,`contracts/evm/out/${name}.sol/${name}.json`),"utf8"));
  const runtime = artifact.deployedBytecode.object.replace(/^0x/,"").length / 2;
  const creation = artifact.bytecode.object.replace(/^0x/,"").length / 2;
  assert.ok(runtime > 0 && runtime <= 24_576,`${name} exceeds EIP-170 runtime limit`);
  assert.ok(creation > 0 && creation <= 49_152,`${name} exceeds EIP-3860 initcode limit`);
  sizes[name] = { runtime, creation };
}
const exported = JSON.parse(readFileSync(resolve(root,"contracts/evm/abi.json"),"utf8"));
const legacyAbi = JSON.parse(run("git",["show",`${baseline}:contracts/evm/abi.json`]));
for (const key of Object.keys(legacyAbi)) assert.deepEqual(exported[key],legacyAbi[key],`Legacy ABI drift: ${key}`);
for (const name of contracts) {
  const artifact = JSON.parse(readFileSync(resolve(root,`contracts/evm/out/${name}.sol/${name}.json`),"utf8"));
  assert.deepEqual(exported[name],artifact.abi,`Exported ABI differs from compiled ${name}`);
}
if (!usdt0Only) {
  assert.equal(exported.cctpV4DirectRelease.domain.version,"4");
  assert.equal(exported.cctpV4BridgeRelease.domain.version,"4");
  assert.equal(exported.cctpV4BridgeReceipt.domain.version,"4");
}
console.log(JSON.stringify({ scope:"local-contract-tests-and-legacy-source-preservation", tests, sizes,
  liveIssuerVerification:"required-before-activation", deployment:"not-broadcast", attestorTrust:"foreign-receipts-remain-offchain" }));
console.log(usdt0Only ? "USDT0_FACTORY_VERIFIED" : "MAINNET_CONTRACTS_VERIFIED");
