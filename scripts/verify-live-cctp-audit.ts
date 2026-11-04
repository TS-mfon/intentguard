import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createPublicClient, http, parseAbi, decodeEventLog, decodeFunctionData, encodeAbiParameters, padHex, keccak256, hashTypedData, recoverTypedDataAddress, getAddress, type Abi, type Hex, type Address} from "viem";
import {createClient} from "genlayer-js";
import {studionet} from "genlayer-js/chains";
import {TransactionHashVariant, type Hash as GLHash} from "genlayer-js/types";
import artifacts from "../contracts/evm/abi.json";
import {canonical, digest, parseAmount, validateDecision, policySchema} from "../packages/shared";
import {CCTP_TESTNETS, CCTP_IRIS_TESTNET} from "../packages/shared/assets";
import {assertFinalized, normalizedCalldata, normalizeStudioTransaction} from "../apps/web/lib/genlayer";

// Read-only verification. All evidence, receipts and GenLayer decisions are
// public; this script never loads an agent key, wallet key or database URI.
const path = process.argv.find(value => value.endsWith(".json")) ?? "docs/audits/live-cctp-2026-11-04.json";
const audit = JSON.parse(await readFile(path, "utf8"));
assert.equal(audit.version, 1);
const origin = audit.deployment.apiOrigin;
assert.equal(origin, "https://intentguard-tapeout.vercel.app");
assert.equal(audit.deployment.paymentEnvironment, "testnet");
assert.equal(audit.deployment.paymentChainId, 1952);
assert.equal(audit.deployment.reviewChainId, 61999);
const card = audit.agent, purchase = audit.purchase;
const sourceRoute = CCTP_TESTNETS[1952], target = CCTP_TESTNETS[purchase.input.destinationChainId];
assert.ok(target && [84532, 421614].includes(target.chainId));
const abi = artifacts.CctpSpendingCard as Abi;
const source = createPublicClient({transport: http(sourceRoute.rpcUrl, {timeout: 25000, retryCount: 2})});
const destination = createPublicClient({transport: http(target.rpcUrl, {timeout: 25000, retryCount: 2})});
const gl = createClient({chain: studionet, endpoint: "https://studio.genlayer.com/api"});
const tokenAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Burn(address indexed burner,uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);
const transmitterAbi = parseAbi([
  "event MessageSent(bytes message)",
  "event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)",
  "function receiveMessage(bytes message,bytes attestation) returns (bool)",
  "function usedNonces(bytes32 nonce) view returns (uint256)",
]);
const zero = "0x" + "0".repeat(40), zeroWord = padHex("0x0", {size: 32});
const lower = (value: string) => value.toLowerCase();
const amount = parseAmount(purchase.input.amount);
const reportHash = createHash("sha256").update(audit.researchReport.text).digest("hex");
assert.equal(reportHash, audit.researchReport.sha256);
assert.ok(["PAID", "REJECTED"].includes(purchase.status));
assert.equal(purchase.id, digest({cardId: card.id, idempotency: purchase.idempotencyKey}));
assert.equal(purchase.admission.status, 202);
assert.equal(purchase.admission.id, purchase.id);
assert.equal(lower(card.token), lower(sourceRoute.token));
assert.equal(card.settlement.asset, "USDC");
assert.ok(card.settlement.destinationChainIds.includes(target.chainId));
const policy = policySchema.parse(card.policy);
assert.equal(digest(policy), card.policyHash);
assert.ok(policy.allowedCategories.includes(purchase.input.category));
assert.ok(policy.merchants.some(merchant => lower(merchant.recipient) === lower(purchase.input.recipient) && merchant.origins.includes(origin) && merchant.products.includes("Research reports")));
assert.equal(await source.getChainId(), 1952);
assert.equal(await destination.getChainId(), target.chainId);

async function json(url: string, includeContent = false): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {redirect: "error", signal: AbortSignal.timeout(45000)});
      assert.equal(response.status, 200, url);
      const content = await response.text(), data = JSON.parse(content);
      return includeContent ? {content, data} : data;
    } catch (error) {
      if (attempt === 2 || error instanceof assert.AssertionError) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
function events(receipt: any, address: string, eventAbi: Abi): any[] {
  const decoded = [];
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(address)) continue;
    try {decoded.push(decodeEventLog({abi: eventAbi, data: log.data, topics: log.topics}));} catch {}
  }
  return decoded;
}
function messageFields(message: string) {
  assert.match(message, /^0x[0-9a-fA-F]+$/);
  const bytes = Buffer.from(message.slice(2), "hex");
  assert.equal(bytes.length, 376);
  const at = (offset: number, size: number): Hex => "0x" + bytes.subarray(offset, offset + size).toString("hex") as Hex;
  const uint = (offset: number, size: number) => BigInt(at(offset, size));
  assert.equal(uint(0, 4), 1n);
  assert.equal(uint(148, 4), 1n);
  assert.equal(uint(4, 4), 37n);
  assert.equal(uint(8, 4), BigInt(target.domain));
  assert.equal(at(44, 32), lower(padHex(sourceRoute.messenger, {size: 32})));
  assert.equal(at(76, 32), lower(padHex(target.messenger, {size: 32})));
  assert.equal(at(108, 32), zeroWord);
  assert.equal(uint(140, 4), 2000n);
  assert.equal(at(152, 32), lower(padHex(sourceRoute.token, {size: 32})));
  assert.equal(at(184, 32), lower(padHex(purchase.input.recipient as Address, {size: 32})));
  assert.equal(uint(216, 32), amount);
  assert.equal(at(248, 32), lower(padHex(card.vault as Address, {size: 32})));
  assert.equal(uint(280, 32), 0n);
  assert.equal(uint(312, 32), 0n);
  assert.equal(uint(344, 32), 0n);
  return {nonce: at(12, 32), finalityExecuted: uint(144, 4), body: at(148, 228)};
}

const publicRecord = await json(origin + "/api/v1/explorer/transactions/" + purchase.id);
assert.equal(publicRecord.transaction.status, purchase.status);
assert.equal(publicRecord.transaction.cardId, card.id);
assert.equal(publicRecord.transaction.paymentTxHash, purchase.paymentTxHash);
assert.equal(publicRecord.transaction.destinationChainId, target.chainId);
assert.equal(lower(publicRecord.transaction.destinationToken), lower(target.token));
assert.equal(publicRecord.transaction.requestHash, purchase.requestHash);
assert.equal(publicRecord.transaction.evidenceHash, purchase.evidenceHash);
assert.equal(publicRecord.agent.policyHash, card.policyHash);
assert.equal(lower(publicRecord.agent.address), lower(card.vault));
assert.equal(await source.readContract({address: card.vault, abi, functionName: "policyHash"}), card.policyHash);
assert.equal(lower(String(await source.readContract({address: card.vault, abi, functionName: "token"}))), lower(sourceRoute.token));
const owner: any = await source.readContract({address: card.vault, abi, functionName: "owner"});
assert.equal(lower(owner), lower(publicRecord.agent.owner));
const activation = await source.getTransactionReceipt({hash: card.activationTx as Hex});
assert.equal(activation.status, "success");
assert.equal(lower(activation.to!), lower(audit.deployment.cctpFactoryAddress));
const created = events(activation, audit.deployment.cctpFactoryAddress, artifacts.CctpCardFactory as Abi).filter(event => event.eventName === "CardCreated" && lower(event.args.card) === lower(card.vault));
assert.equal(created.length, 1);
assert.equal(created[0].args.policyHash, card.policyHash);
assert.equal(lower(created[0].args.owner), lower(owner));
console.log("LIVE_CCTP_BUYER_VAULT_ACTIVATION_VERIFIED", card.activationTx);
const domains: any = await source.readContract({address: card.vault, abi, functionName: "allowedDomains"});
assert.deepEqual([...domains].sort((a: number, b: number) => a - b), card.settlement.destinationChainIds.map((id: number) => CCTP_TESTNETS[id].domain).sort((a: number, b: number) => a - b));
const chainRequest: any = await source.readContract({address: card.vault, abi, functionName: "getRequest", args: [purchase.id]});
assert.equal(chainRequest.status, purchase.status === "PAID" ? 2 : 3);
assert.equal(lower(chainRequest.recipient), lower(purchase.input.recipient));
assert.equal(chainRequest.amount, amount);
assert.equal(chainRequest.requestHash, purchase.requestHash);
assert.equal(chainRequest.evidenceHash, purchase.evidenceHash);

const tx = normalizeStudioTransaction(await gl.getTransaction({hash: purchase.genLayerTxHash as GLHash}), purchase.genLayerTxHash);
assertFinalized(tx);
const reviewerTarget = tx.recipient ?? tx.to_address;
assert.ok(reviewerTarget);
assert.equal(lower(reviewerTarget), lower(card.reviewerAddress));
const call: any = normalizedCalldata((tx.txDataDecoded as any).callData);
assert.equal(call.method, "review");
assert.equal(call.args.length, 3);
assert.equal(call.args[0], purchase.id);
const committed = JSON.parse(call.args[1]), snapshots = JSON.parse(call.args[2]);
assert.equal(digest(committed), purchase.requestHash);
assert.equal(digest(snapshots), purchase.evidenceHash);
assert.equal(committed.policyHash, card.policyHash);
assert.equal(lower(committed.cardAddress), lower(card.vault));
assert.equal(lower(committed.token), lower(sourceRoute.token));
assert.equal(committed.chainId, 1952);
assert.equal(committed.destinationChainId, target.chainId);
assert.equal(committed.destinationDomain, target.domain);
assert.equal(lower(committed.destinationToken), lower(target.token));
assert.equal(committed.settlementHash, digest(card.settlement));
assert.equal(committed.amountAtomic, amount.toString());
for (const field of Object.keys(purchase.input)) assert.equal(canonical(committed[field]), canonical(purchase.input[field]), field);
assert.equal(snapshots.length, 1);
assert.equal(snapshots[0].url, purchase.input.evidence[0].url);
assert.equal(snapshots[0].sha256, "0x" + createHash("sha256").update(snapshots[0].content).digest("hex"));
const invoiceResponse = await json(snapshots[0].url, true), invoice = invoiceResponse.data;
assert.equal(invoiceResponse.content, snapshots[0].content);
assert.equal(canonical(invoice), canonical(JSON.parse(snapshots[0].content)));
assert.equal(canonical(invoice), canonical(audit.invoice.invoice));
assert.equal(invoice.invoiceId, purchase.input.invoiceId);
assert.equal(lower(invoice.buyer), lower(card.vault));
assert.equal(lower(invoice.recipient), lower(purchase.input.recipient));
assert.equal(invoice.amount, purchase.input.amount);
assert.equal(invoice.chainId, target.chainId);
assert.equal(lower(invoice.token), lower(target.token));
assert.equal(invoice.description, audit.researchReport.text);
assert.ok(invoice.issuedAt <= snapshots[0].fetchedAt && invoice.expiresAt > snapshots[0].fetchedAt);
assert.ok(invoice.issuedAt >= snapshots[0].fetchedAt - policy.evidence.maxAgeSeconds);
const review = validateDecision(JSON.parse(String(await gl.readContract({address: getAddress(card.reviewerAddress), functionName: "get_review", args: [purchase.id], jsonSafeReturn: true, transactionHashVariant: TransactionHashVariant.LATEST_FINAL}))), policy, committed, purchase.requestHash);
assert.equal(review.decision, purchase.status === "PAID" ? "APPROVE" : "REJECT");
assert.equal(canonical(review), canonical(purchase.review));
assert.equal(canonical(review), canonical(publicRecord.transaction.review));
console.log("LIVE_CCTP_REVIEW_VERIFIED", review.decision, purchase.genLayerTxHash);

if (purchase.status === "REJECTED") {
  assert.ok(!purchase.paymentTxHash && !purchase.bridge && !publicRecord.transaction.bridge);
  assert.equal(review.criteria.find(criterion => criterion.id === "invoice")?.status, "FAIL");
  const cancelled: any = await source.readContract({address: card.vault, abi, functionName: "getBridgeRequest", args: [purchase.id]});
  assert.equal(cancelled.sourceTxHash, zeroWord);
  assert.equal(cancelled.destinationTxHash, zeroWord);
  console.log("LIVE_CCTP_CORRECTED_REJECTION_VERIFIED", purchase.id);
  await verifyRejectedAttempts();
  await verifyPriorMerchantFailure();
  console.log("LIVE_CCTP_AUDIT_VERIFIED", purchase.status, purchase.id);
  process.exit(0);
}

const proofRecord = await json(origin + "/api/v1/explorer/transactions/" + purchase.id + "/proof");
const proof = proofRecord.proof;
assert.equal(proofRecord.id, purchase.id);
assert.equal(proofRecord.proofHash, digest(proof));
assert.equal(audit.bridgeProof.proofHash, proofRecord.proofHash);
assert.equal(canonical(audit.bridgeProof.proof), canonical(proof));
for (const [field, expected] of Object.entries({requestId: purchase.id, requestHash: purchase.requestHash, policyHash: card.policyHash, evidenceHash: purchase.evidenceHash, genLayerTxHash: purchase.genLayerTxHash, decisionHash: digest(review), sourceCommit: audit.deployment.sourceCommit, releaseId: audit.deployment.releaseId, paymentEnvironment: "testnet", reviewEnvironment: "testnet", sourceChainId: 1952, destinationChainId: target.chainId, destinationDomain: target.domain, amountAtomic: amount.toString()})) assert.equal(proof[field], expected, field);
assert.equal(lower(proof.recipient), lower(purchase.input.recipient));
assert.equal(lower(proof.sourceToken), lower(sourceRoute.token));
assert.equal(lower(proof.destinationToken), lower(target.token));
const bridge = purchase.bridge;
const burn = await source.getTransactionReceipt({hash: bridge.sourceTxHash as Hex});
assert.equal(burn.status, "success");
assert.ok(await source.getBlockNumber() >= burn.blockNumber + 1n);
assert.equal(proof.sourceReceipt.transactionHash, burn.transactionHash);
const started = events(burn, card.vault, abi).filter(event => event.eventName === "BridgeStarted" && event.args.requestId === purchase.id);
assert.equal(started.length, 1);
assert.equal(started[0].args.amount, amount);
assert.equal(lower(started[0].args.recipient), lower(purchase.input.recipient));
assert.equal(started[0].args.destinationDomain, target.domain);
assert.equal(started[0].args.decisionHash, digest(review));
assert.equal(started[0].args.genLayerTxHash, purchase.genLayerTxHash);
const routeHash = keccak256(encodeAbiParameters([{type: "uint32"}, {type: "bytes32"}, {type: "uint64"}, {type: "uint256"}, {type: "uint32"}, {type: "bytes32"}], [target.domain, padHex(purchase.input.recipient as Address, {size: 32}), amount, 0n, 2000, zeroWord]));
assert.equal(started[0].args.routeHash, routeHash);
const burnEvents = events(burn, sourceRoute.token, tokenAbi);
assert.equal(burnEvents.filter(event => event.eventName === "Transfer" && lower(event.args.from) === lower(card.vault) && lower(event.args.to) === lower(sourceRoute.minter) && event.args.value === amount).length, 1);
assert.equal(burnEvents.filter(event => event.eventName === "Burn" && lower(event.args.burner) === lower(sourceRoute.minter) && event.args.amount === amount).length, 1);
const sent = events(burn, sourceRoute.transmitter, transmitterAbi).filter(event => event.eventName === "MessageSent");
assert.equal(sent.length, 1);
assert.equal(lower(sent[0].args.message), lower(proof.originalMessage));
const original = messageFields(proof.originalMessage), attested = messageFields(proof.attestedMessage);
assert.equal(original.nonce, zeroWord);
assert.equal(original.finalityExecuted, 0n);
assert.notEqual(attested.nonce, zeroWord);
assert.ok(attested.finalityExecuted >= 2000n);
const stable = (message: string) => message.slice(0, 2 + 12 * 2) + message.slice(2 + 44 * 2, 2 + 144 * 2) + message.slice(2 + 148 * 2);
assert.equal(lower(stable(proof.originalMessage)), lower(stable(proof.attestedMessage)));
assert.equal(keccak256(proof.attestedMessage), bridge.messageHash);
assert.equal(bridge.nonce, attested.nonce);
const iris = await json(CCTP_IRIS_TESTNET + "/v2/messages/37?transactionHash=" + bridge.sourceTxHash);
assert.equal(lower(iris.sourceTxHash), lower(bridge.sourceTxHash));
const attestations = iris.messages.filter((item: any) => item.cctpVersion === 2 && item.status === "complete");
assert.equal(attestations.length, 1);
assert.equal(lower(attestations[0].message), lower(proof.attestedMessage));
assert.equal(lower(attestations[0].attestation), lower(proof.attestation));
console.log("LIVE_CCTP_BURN_AND_ATTESTATION_VERIFIED", bridge.sourceTxHash);

const mint = await destination.getTransactionReceipt({hash: purchase.paymentTxHash as Hex});
assert.equal(mint.status, "success");
assert.ok(await destination.getBlockNumber() >= mint.blockNumber + 1n);
assert.equal(proof.destinationReceipt.transactionHash, mint.transactionHash);
const mintTx = await destination.getTransaction({hash: purchase.paymentTxHash as Hex});
assert.equal(lower(mintTx.to!), lower(target.transmitter));
const receive: any = decodeFunctionData({abi: transmitterAbi, data: mintTx.input});
assert.equal(receive.functionName, "receiveMessage");
assert.equal(lower(receive.args[0]), lower(proof.attestedMessage));
assert.equal(lower(receive.args[1]), lower(proof.attestation));
const received = events(mint, target.transmitter, transmitterAbi).filter(event => event.eventName === "MessageReceived" && event.args.nonce === attested.nonce);
assert.equal(received.length, 1);
assert.equal(received[0].args.sourceDomain, 37);
assert.equal(lower(received[0].args.sender), lower(padHex(sourceRoute.messenger, {size: 32})));
assert.equal(BigInt(received[0].args.finalityThresholdExecuted), attested.finalityExecuted);
assert.equal(lower(received[0].args.messageBody), lower(attested.body));
assert.equal(events(mint, target.token, tokenAbi).filter(event => event.eventName === "Transfer" && lower(event.args.from) === zero && lower(event.args.to) === lower(purchase.input.recipient) && event.args.value === amount).length, 1);
assert.equal(await destination.readContract({address: target.transmitter, abi: transmitterAbi, functionName: "usedNonces", args: [attested.nonce]}), 1n);
console.log("LIVE_CCTP_DESTINATION_MINT_VERIFIED", purchase.paymentTxHash);

const chainBridge: any = await source.readContract({address: card.vault, abi, functionName: "getBridgeRequest", args: [purchase.id]});
assert.equal(chainBridge.sourceTxHash, bridge.sourceTxHash);
assert.equal(chainBridge.destinationTxHash, purchase.paymentTxHash);
assert.equal(chainBridge.messageHash, bridge.messageHash);
assert.equal(chainBridge.routeHash, routeHash);
const acknowledgement = await source.getTransactionReceipt({hash: bridge.confirmationTxHash as Hex});
assert.equal(acknowledgement.status, "success");
assert.ok(await source.getBlockNumber() >= acknowledgement.blockNumber + 1n);
const ackTx = await source.getTransaction({hash: bridge.confirmationTxHash as Hex});
assert.equal(lower(ackTx.to!), lower(card.vault));
const confirmation: any = decodeFunctionData({abi, data: ackTx.input});
assert.equal(confirmation.functionName, "confirmBridge");
assert.deepEqual(confirmation.args.slice(0, 4), [purchase.id, bridge.sourceTxHash, purchase.paymentTxHash, bridge.messageHash]);
const receiptTypes = {BridgeReceipt: [
  {name: "requestId", type: "bytes32"}, {name: "requestHash", type: "bytes32"},
  {name: "routeHash", type: "bytes32"}, {name: "sourceTxHash", type: "bytes32"},
  {name: "destinationTxHash", type: "bytes32"}, {name: "messageHash", type: "bytes32"},
  {name: "amount", type: "uint64"},
]} as const;
assert.deepEqual(receiptTypes.BridgeReceipt.map(({name, type}) => [name, type]), artifacts.bridgeReceipt.fields);
const typed = {domain: {name: "IntentGuard", version: "2", chainId: 1952, verifyingContract: card.vault as Address}, primaryType: "BridgeReceipt" as const, types: receiptTypes, message: {requestId: purchase.id as Hex, requestHash: purchase.requestHash as Hex, routeHash, sourceTxHash: bridge.sourceTxHash as Hex, destinationTxHash: purchase.paymentTxHash as Hex, messageHash: bridge.messageHash as Hex, amount}};
assert.equal(hashTypedData(typed), proof.acknowledgement.digest);
const attestor: any = await source.readContract({address: card.vault, abi, functionName: "attestor"});
assert.equal(lower(await recoverTypedDataAddress({...typed, signature: confirmation.args[4]})), lower(attestor));
assert.equal(lower(proof.acknowledgement.attestor), lower(attestor));
const paid = events(acknowledgement, card.vault, abi).filter(event => event.eventName === "BridgePaid" && event.args.requestId === purchase.id);
assert.equal(paid.length, 1);
for (const field of ["sourceTxHash", "destinationTxHash", "messageHash"]) assert.equal(paid[0].args[field], chainBridge[field]);
console.log("LIVE_CCTP_ACKNOWLEDGEMENT_VERIFIED", bridge.confirmationTxHash);

async function verifyRejectedAttempts() {
 assert.equal(audit.rejectedAttempts.length, 1);
 for (const rejected of audit.rejectedAttempts) {
  const record = await json(origin + "/api/v1/explorer/transactions/" + rejected.id);
  assert.equal(record.transaction.status, "REJECTED");
  assert.equal(rejected.id, digest({cardId: card.id, idempotency: rejected.idempotencyKey}));
  assert.ok(!record.transaction.paymentTxHash && !record.transaction.bridge);
  const request: any = await source.readContract({address: card.vault, abi, functionName: "getRequest", args: [rejected.id]});
  assert.equal(request.status, 3);
  assert.equal(request.requestHash, rejected.requestHash);
  assert.equal(request.evidenceHash, rejected.evidenceHash);
  const rejectedTx = normalizeStudioTransaction(await gl.getTransaction({hash: rejected.genLayerTxHash as GLHash}), rejected.genLayerTxHash);
  assertFinalized(rejectedTx);
  const rejectedTarget = rejectedTx.recipient ?? rejectedTx.to_address;
  assert.ok(rejectedTarget);
  assert.equal(lower(rejectedTarget), lower(card.reviewerAddress));
  const rejectedCall: any = normalizedCalldata((rejectedTx.txDataDecoded as any).callData);
  assert.equal(rejectedCall.method, "review");
  assert.equal(rejectedCall.args[0], rejected.id);
  const rejectedCommitment = JSON.parse(rejectedCall.args[1]), rejectedSnapshots = JSON.parse(rejectedCall.args[2]);
  assert.equal(digest(rejectedCommitment), rejected.requestHash);
  assert.equal(digest(rejectedSnapshots), rejected.evidenceHash);
  assert.equal(rejectedCommitment.policyHash, card.policyHash);
  for (const field of Object.keys(rejected.input)) assert.equal(canonical(rejectedCommitment[field]), canonical(rejected.input[field]));
  assert.equal(rejectedSnapshots.length, 1);
  const rejectedInvoiceResponse = await json(rejectedSnapshots[0].url, true), rejectedInvoice = rejectedInvoiceResponse.data;
  assert.equal(rejectedInvoiceResponse.content, rejectedSnapshots[0].content);
  assert.equal(rejectedSnapshots[0].sha256, "0x" + createHash("sha256").update(rejectedSnapshots[0].content).digest("hex"));
  assert.equal(canonical(rejectedInvoice), canonical(JSON.parse(rejectedSnapshots[0].content)));
  assert.equal(canonical(rejectedInvoice), canonical(rejected.invoice.invoice));
  assert.equal(lower(rejectedInvoice.token), lower(rejectedCommitment.destinationToken));
  assert.notEqual(lower(rejectedInvoice.token), lower(rejectedCommitment.token));
  const rejectedReview = validateDecision(JSON.parse(String(await gl.readContract({address: getAddress(card.reviewerAddress), functionName: "get_review", args: [rejected.id], jsonSafeReturn: true, transactionHashVariant: TransactionHashVariant.LATEST_FINAL}))), policy, rejectedCommitment, rejected.requestHash);
  assert.equal(rejectedReview.decision, "REJECT");
  assert.equal(canonical(rejectedReview), canonical(rejected.review));
  assert.equal(canonical(rejectedReview), canonical(record.transaction.review));
  assert.equal(rejectedReview.criteria.find(criterion => criterion.id === "invoice")?.status, "FAIL");
  const cancelledBridge: any = await source.readContract({address: card.vault, abi, functionName: "getBridgeRequest", args: [rejected.id]});
  assert.equal(cancelledBridge.sourceTxHash, zeroWord);
  assert.equal(cancelledBridge.destinationTxHash, zeroWord);
  console.log("LIVE_CCTP_INITIAL_REJECTION_VERIFIED", rejected.id);
 }
}

async function verifyPriorMerchantFailure() {
 const failed = audit.priorUnreachableMerchantAttempt;
const failedRecord = await json(origin + "/api/v1/explorer/transactions/" + failed.id);
assert.equal(failedRecord.transaction.status, "NEEDS_EVIDENCE");
assert.equal(failedRecord.transaction.errorCode, "EVIDENCE_UNAVAILABLE");
assert.equal(failedRecord.reviewStage.status, "SKIPPED");
assert.ok(!failedRecord.transaction.genLayerTxHash && !failedRecord.transaction.paymentTxHash && !failedRecord.transaction.bridge);
assert.equal(failedRecord.agent.id, failed.cardId);
assert.equal(lower(failedRecord.agent.address), lower(failed.vault));
const failedRequest: any = await source.readContract({address: failed.vault, abi, functionName: "getRequest", args: [failed.id]});
assert.equal(failedRequest.status, 0);
 console.log("LIVE_CCTP_PRIOR_MERCHANT_FAILURE_VERIFIED", failed.id);
}
await verifyRejectedAttempts();
await verifyPriorMerchantFailure();
console.log("LIVE_CCTP_DELIVERY_VERIFIED", purchase.id);
console.log("LIVE_CCTP_AUDIT_VERIFIED", purchase.status, purchase.id);
