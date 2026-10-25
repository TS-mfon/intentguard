# IntentGuard

An owner-funded spending card for an AI agent. Define a mission and permissions in ordinary language, approve the exact proposed terms, then let the agent request merchant payments with its own API key.

The dark console provides a public landing page, complete policy setup, an owner workspace and public agent/transaction explorers. Owners retain funding, pause, revocation, cancellation, withdrawal and one-time credential controls.

Live app: https://intentguard-gen-daves-projects.vercel.app
Documentation: https://intentguard-gen-daves-projects.vercel.app/docs
Create an agent: https://intentguard-gen-daves-projects.vercel.app/agent-setup
Public explorer: https://intentguard-gen-daves-projects.vercel.app/explorer
Repository: https://github.com/TS-mfon/intentguard

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

Open http://localhost:3000. Public activity comes from persisted requests. An empty or unavailable backend shows its actual state.

For real API operations, configure MongoDB, deployed contracts and a 32-character-or-longer session secret using the fields in `.env.example`. The hosted installation runs its durable queue exclusively through [GitHub Actions](docs/ACTIONS-WORKER.md), with signing credentials stored as repository secrets.

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

Provide public HTTPS JSON/text evidence. Each source is limited to 64 KiB and the bundle to 128 KiB. The merchant invoice must identify the card buyer, the configured X Layer chain and six-decimal payment token, recipient, exact amount, issue time and expiry. The reviewer verifies merchant-origin content; it cannot prove that a dishonest merchant's claims are objectively true.

See the [complete application docs](https://intentguard-gen-daves-projects.vercel.app/docs), [OpenAPI](docs/openapi.json), [integration contract](docs/CONTRACT.md), [architecture](docs/ARCHITECTURE.md) and [deployment](docs/DEPLOYMENT.md).

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

The hosted build uses X Layer testnet 1952 and GenLayer Studionet 61999. Testnet addresses and transaction evidence are in [TESTNET.md](docs/TESTNET.md). The evaluator uses TapeOut’s unchanged NetlistVM in a labelled testnet adapter; TEST-USDT is a faucet token. See deployment notes for attestor and protocol trust assumptions.

Hosted acceptance scripts use the private configured testnet environment and a resumable journal:
```sh
pnpm exec tsx scripts/hosted-check.ts --run
pnpm exec tsx scripts/hosted-browser.ts
```
The first verifies actual contract execution and exactly-once payments; the second verifies real wallet-login signatures, hosted records and finalized reasoning on both aliases. Public evidence is in [deployments](docs/deployments/).
