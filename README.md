# IntentGuard

An owner-funded spending card for an AI agent. Define a mission and permissions in ordinary language, approve the exact proposed terms, then let the agent request merchant payments with its own API key.

The dashboard combines ATM-style spending cards, agent identities and a payment ledger. Owners retain funding, pause, revocation, cancellation and withdrawal controls.

## What each protocol does

1. **GenLayer interprets permissions.** A GenLayer intelligent contract proposes a typed policy and independent validators check fidelity to the owner's instructions. The owner reviews all financial terms, merchants, evidence sources and purchase criteria before activating an immutable card.
2. **TapeOut evaluates the budget.** An actual 1,766-NAND circuit compares exact 64-bit USDT amounts against payment, lifetime and period limits and checks validity/permission flags. The X Layer vault calls the processor to reserve capacity before semantic review. Pending payments count against the budget.
3. **GenLayer reviews evidence.** Every reserved payment is reviewed against the immutable policy. Validators independently refetch public merchant sources, check snapshot hashes, invoice fields and purchase criteria. A pending, unsuccessful or changed result cannot authorize release.
4. **The vault pays the merchant.** The worker waits for successful finalized GenLayer consensus, validates all commitments and signs an EIP712 release. X Layer trusts the configured attestor for this foreign-chain approval. The vault rechecks TapeOut and transfers the exact reserved amount once.

The circuit metadata, processor implementation and raw-netlist SHA256 are pinned. A change to the protocol implementation stops spending. Owner withdrawal of unreserved funds remains available.

## Run

Requirements: Node 24, pnpm 11, Foundry for EVM checks, Python/uv and the GenLayer testing tools for contract checks.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. An unconfigured installation provides a clearly marked sample preview. It never records sample payments as live ones.

For real API operations, copy `.env.example` to `.env`, configure MongoDB, deployed contracts and a 32-character-or-longer session secret. The environment must be loaded into the worker process, for example:

```sh
node --env-file=.env --import tsx apps/worker/main.ts
```

Next loads the web environment from `apps/web/.env.local`; configure the shared non-worker fields there or inject them through the deployment platform. The worker needs three dedicated signing keys. The web server only needs public gateway/attestor addresses and its session/database secrets.

## Activate an agent card

Connect an owner EVM wallet and sign the dashboard login challenge. Create a card, describe the mission, specify budgets, merchants, evidence and criteria, and request a GenLayer proposal. Review and approve the finalized policy, activate on X Layer, and fund the resulting card with USDT. Once the per-card reviewer is finalized, issue an API key and save it securely.

An API key authorizes requests for one card; it does not control the owner's wallet. Rotation/revocation stops pending requests under the previous credential. The owner can pause or permanently revoke the vault onchain.

## Agent API

```ts
import {IntentGuard} from "./packages/sdk";
const guard = new IntentGuard("https://your-app.example", process.env.INTENTGUARD_API_KEY!);
const queued = await guard.request({
  recipient: "0xYourApprovedMerchantAddress",
  amount: "5.000001",
  purchaseDescription: "Protocol revenue data",
  justification: "Required for the approved research mission",
  category: "data",
  invoiceId: "invoice-0001",
  evidence: [{url: "https://merchant.example/invoices/invoice-0001"}]
}, "research-task-0001");
const result = await guard.wait(queued.id);
```

Reuse the same Idempotency-Key when retrying the same request. Different payment details under that key return HTTP 409. A rejected or corrected invoice requires a new request and a new key.

Provide public HTTPS JSON/text evidence. Each source is limited to 64 KiB and the bundle to 128 KiB. The merchant invoice must identify the card buyer, X Layer 196, USDT token, recipient, exact amount, issue time and expiry. The reviewer verifies merchant-origin content; it cannot prove that a dishonest merchant's claims are objectively true.

See [OpenAPI](docs/openapi.json), [integration contract](docs/CONTRACT.md), [architecture](docs/ARCHITECTURE.md), [deployment](docs/DEPLOYMENT.md) and [three-minute demo](docs/DEMO.md).

## Verify

```sh
pnpm typecheck
pnpm test
node tools/check.mjs evm
node tools/check.mjs circuit
node tools/check.mjs genlayer
node tools/check.mjs integration
node tools/check.mjs build
node tools/check.mjs browser
node tools/check.mjs release
```

The integration boots an isolated Anvil chain with fresh local test accounts, the unmodified TapeOut NetlistVM, generated circuit, vault, signatures and token transfers. GenLayer fixtures in this integration are explicitly test-only; separate direct contract tests execute the intelligent-contract validation paths. Browser checks exercise the owner flow with typed test API responses and a wallet that refuses live signing.

No live deployment or mainnet transfer has been made during implementation. Live operation requires dedicated funded wallets and contract configuration. The project is a hackathon MVP; see deployment notes for the attestor and protocol trust assumptions.
