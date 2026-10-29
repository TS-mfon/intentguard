import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {readFile} from "node:fs/promises";
import {ProtocolClient, IntentGuardError, REQUEST_STATES, TERMINAL_STATES, validatePayment} from "../../sdk/client.mjs";

export const terminalStates = new Set(TERMINAL_STATES);
const id = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const payment = z.object({
  destinationChainId: z.number().int().positive().safe().optional(), recipient: address,
  amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/),
  purchaseDescription: z.string().min(3).max(2000), justification: z.string().min(3).max(6000),
  category: z.string().min(1).max(200), invoiceId: z.string().min(1).max(200),
  evidence: z.array(z.object({url: z.url().max(2048), sha256: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional()}).strict()).min(1).max(8),
}).strict().superRefine((value, ctx) => { try { validatePayment(value); } catch (e) { ctx.addIssue({code: "custom", message: e.message}); } });

export function createProtocolServer(options) {
  const client = new ProtocolClient(options);
  const server = new McpServer({name: "intentguard-protocol", version: "0.4.0"}, {
    instructions: "Read intentguard://protocol, intentguard://openapi and intentguard://integration. An explicit API origin and payment environment are required. Public explorer tools never transmit a credential. Authenticated tools verify anonymous deployment identity before sending the environment-scoped agent key, and verify the actual card before admission. Mainnet payments on X Layer 196 use GenLayer Studionet 61999 TESTNET review. Version 2 settlement requires V4 review; legacy testnet permissions remain compatible. HTTP 202, APPROVED, burn, attestation and submitted mint are pending. Only payment status PAID confirms delivery. Keep one Idempotency-Key and the exact same input per purchase. This server has no owner signing or merchant-admin authority and never creates a replacement vault or new purchase without the user's existing authorization.",
  });
  async function run(action, status = 200) {
    try { return {ok: true, status, data: await action()}; }
    catch (e) {
      if (e instanceof IntentGuardError) return {ok: false, error: {code: e.code, message: e.message, status: e.status, retryable: e.retryable,
        ...(e.requestId ? {requestId: e.requestId} : {}), ...(e.retryAfterSeconds !== undefined ? {retryAfterSeconds: e.retryAfterSeconds} : {}), ...(e.details !== undefined ? {details: e.details} : {})}};
      return {ok: false, error: {code: "CLIENT_ERROR", message: "The client could not verify this operation. Preserve its ID and reconcile it before retrying.", status: 0, retryable: false}};
    }
  }
  const output = value => ({content: [{type: "text", text: JSON.stringify(value)}], structuredContent: value, ...(value.ok === false ? {isError: true} : {})});
  const register = (name, description, inputSchema, handler, readOnly = true) => server.registerTool(name, {description, inputSchema,
    annotations: {readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: true, openWorldHint: true}}, async args => output(await handler(args)));
  register("get_config", "Read anonymous configuration and verify API/frontend/payment/source/review/release identity against the explicit server profile. configured=false is a real unavailable state.", {}, () => run(() => client.capabilities()));
  register("get_health", "Read anonymous release identity, public dependency readiness and worker freshness. A degraded health payload is information; it does not authorize payment.", {}, () => run(() => client.health()));
  register("get_my_agent", "Read this agent key's card, immutable policy, actual source token, balances, V2 settlement and reviewer version after anonymous identity verification. Owner sessions and agent keys are separate.", {}, () => run(() => client.me()));
  register("submit_payment", "Admit ONE previously owner-permitted invoice-backed purchase. Fresh anonymous config and credential/card verification precede POST. Keep this exact payload and idempotencyKey on retry. The invoice buyer is the X Layer vault; chain/token identify actual delivery. HTTP 202 is admission; existing CCTP burns must be reconciled rather than repeated. This can cause a token transfer.",
    {payment, idempotencyKey: z.string().regex(/^[ -~]{1,128}$/)}, args => run(() => client.request(args.payment, args.idempotencyKey), 202), false);
  register("get_payment", "Read the SAME credential-bound operation after deployment/card verification. PAID means delivered; terminal failures stop polling. Reads never resubmit a payment.", {id}, args => run(() => client.get(args.id)));
  register("wait_for_payment", "Poll the same saved ID for up to 45 seconds, default 30. A pending response retains its ID and never resubmits or cancels. BRIDGING, AWAITING_ATTESTATION and MINTING are pending.",
    {id, maxWaitMs: z.number().int().min(0).max(45000).default(30000)}, async args => {
      const result = await run(() => client.poll(args.id, {timeoutMs: args.maxWaitMs, intervalMs: 5000}));
      if (!result.ok) return result;
      const polled = result.data;
      return {ok: true, status: 200, data: polled.request, ...(polled.pending ? {pending: true, operationId: args.id, nextAction: "Poll this same ID later. A timeout never authorizes another payment or source burn."} : {})};
    });
  const page = {limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(2048).optional()};
  register("list_agents", "Read actual public agents and cursor pagination without transmitting any credential.", page, args => run(() => client.listAgents(args)));
  register("list_transactions", "Read actual public admitted requests, including failed attempts and unsettled bridge operations. This is not a list of transfers; only PAID funds count as delivered.",
    {...page, agentId: id.optional(), status: z.enum(REQUEST_STATES).optional()}, args => run(() => client.listTransactions(args)));
  register("get_transaction", "Read a public operation without a key. reasoningSource=genlayer-finalized-contract identifies a independently verified finalized review; skipped, failed and unavailable are explicit.", {id}, args => run(() => client.getTransaction(args.id)));
  register("get_agent_card", "Read a public identity/usage snapshot and real admitted-operation/PAID-funds totals. asOf is a snapshot timestamp, not a solvency proof. No credential is transmitted.", {id}, args => run(() => client.getAgentCard(args.id)));
  register("get_bridge_proof", "Read worker-captured CCTP source/message/attestation/destination/acknowledgement data without a key. Independently verify receipts; this is not a foreign-chain light-client proof. PROOF_UNAVAILABLE is a real missing record.", {id}, args => run(() => client.getBridgeProof(args.id)));
  for (const [name, uri, file, mimeType] of [["protocol", "intentguard://protocol", "PROTOCOL.md", "text/markdown"], ["openapi", "intentguard://openapi", "openapi.json", "application/json"], ["integration", "intentguard://integration", "integration.json", "application/json"]]) {
    server.registerResource(name, uri, {description: name === "protocol" ? "Complete portable setup, schemas, recovery and trust boundaries" : name === "integration" ? "Machine-readable client profiles, authorization boundaries, entry points and evidence status" : "Complete HTTP request and response schemas", mimeType},
      async () => ({contents: [{uri, mimeType, text: await readFile(new URL("../resources/" + file, import.meta.url), "utf8")}]}));
  }
  server.registerPrompt("payment_integration", {description: "Inspect environment and immutable permission before planning an authorized purchase.", argsSchema: {task: z.string().max(4000)}}, args => ({messages: [{role: "user", content: {type: "text", text: "Read intentguard://protocol, intentguard://openapi and intentguard://integration. Use get_config and get_my_agent. Preserve the user's existing purchase authorization, exact merchant/invoice evidence, immutable asset and destinations. Plan one stable Idempotency-Key and resumable operation. Task: " + args.task}}]}));
  return server;
}
