# IntentGuard setup and user guide

IntentGuard lets an owner give an agent a funded vault, immutable spending permission and a card-scoped API key. A purchase must pass the TapeOut financial guard and a successfully finalized GenLayer evidence review before funds move. The owner controls funding, withdrawals, pause, revocation and credentials.

The public application is **testnet**. Payments originate on X Layer testnet, chain **1952**, and review runs on GenLayer **Studionet testnet, chain 61999**. Testnet assets have no monetary value. Mainnet payment and onchain frontend hosting remain separate release requirements; selecting a prepared mainnet profile does not create a deployed service.

This guide covers using the hosted application, connecting an agent, running the source and operating a deployment. Exact API schemas and settlement rules are in [PROTOCOL.md](PROTOCOL.md) and [openapi.json](openapi.json).

## Choose your starting point

| Goal | Start here | What you need |
|---|---|---|
| Inspect real records | [Public explorer](https://intentguard-tapeout.vercel.app/explorer) | Browser |
| Try a constrained request | [Visitor sandbox](https://intentguard-tapeout.vercel.app/sandbox) | Browser; a ready sandbox |
| Create and manage an agent | [Create agent](https://intentguard-tapeout.vercel.app/agent-setup) | EVM wallet, X Layer testnet gas and the selected test token |
| Connect your agent | [Agent integration](#connect-your-agent) | An active card, its API key and an actual merchant invoice |
| Run the source | [Local development](#local-development) | Node, pnpm and this repository |
| Host an installation | [Deployment and operations](#deployment-and-operations) | Verified contracts, MongoDB, hosting and dedicated worker credentials |

## Use the app without a wallet

Open the explorer and select an agent or transaction. Public records require no wallet login or API key. You can inspect the exact asset, requested amount, recipient, financial decision, evidence decision and available transaction receipts.

These historical records illustrate different outcomes:

- [Paid purchase](https://intentguard-tapeout.vercel.app/explorer/transactions/0xe76c364d42a8b3f1a98924dc79693a7228d048527bd5dc168ad04d01cd8028ff): inspect the delivery receipt.
- [Budget block](https://intentguard-tapeout.vercel.app/explorer/transactions/0x89e88d85bd8f95529865dc9348d496a971e253aaa1eab9a3fe2c1d67cb439163): the guard denied spending and evidence review was skipped.
- [Semantic rejection](https://intentguard-tapeout.vercel.app/explorer/transactions/0xba422ff64117a52cd030cf2f80b52d02d26f82223b28fc9d075d7be5b87601ef): inspect the failed criteria and finalized review.
- [Evidence failure](https://intentguard-tapeout.vercel.app/explorer/transactions/0xecafc6f325d9ff601bbe7f5e24410040f3c062c423960a8efdf9d576f1e8c886): the submitted evidence did not support payment.

Select an agent in the explorer to view its card and actual usage. **Download card** exports an SVG; **PNG** exports a transparent raster image. Downloads need no wallet. Usage counts completed delivery separately from pending requests and burns.

The [protocol story](https://intentguard-tapeout.vercel.app/why-we-exist) explains the purchase flow. Scroll through its chapters or deliberately start the film and sound. Transaction records and receipts provide the evidence for actual transfers.

### Try the visitor sandbox

1. Open `/sandbox` and check its readiness notice.
2. Choose a permitted purchase, budget block, prohibited purchase or wrong-buyer invoice.
3. Submit the scenario and keep its request link.
4. Follow the actual request status and available receipts. Semantic review can take minutes.

The gateway limits a visitor session to five requests and fixes the merchant, amount and local testnet settlement. Its dedicated card and key stay on the server. It cannot submit an arbitrary purchase or spend from your owner card. Scenario names describe the intended test; the returned record determines the result. See [sandbox operations](production/SANDBOX.md) for deployment readiness and durable limits.

## Create and fund an agent

### 1. Check the environment and connect a wallet

Use the canonical [testnet application](https://intentguard-tapeout.vercel.app). Check its network disclosure before signing or funding. `/api/v1/config` publishes the payment chain, review chain, source/release identity, origins, assets, networks and readiness. `/api/v1/health` reports the database and worker status.

For X Layer testnet, use chain ID `1952`, RPC `https://testrpc.xlayer.tech` and explorer `https://www.oklink.com/xlayer-test`. Obtain testnet gas and the card's selected test token through the relevant network/token faucet. An X Layer balance is required for owner transactions; browser login itself signs a challenge without transferring tokens.

Open **Create agent**, connect the intended owner wallet and sign the login challenge. The wallet that activates the vault becomes its owner. If you change wallet accounts or payment chains, reconnect and authenticate for the intended account before continuing.

### 2. Define the spending permission

Choose **Quick setup** or **Manual setup**. Quick setup offers editable Research assistant, API access and Protocol test templates. Protocol test is restricted to X Layer testnet and uses the configured test merchant when available. Replace example merchant details in the other templates with the provider's actual information.

Prepare these fields:

| Field | What to enter |
|---|---|
| Mission and task context | The work the owner authorizes and why the agent needs purchases |
| Merchants | Verified recipient addresses, public HTTPS origins and permitted products |
| Purchase permissions | Allowed categories, prohibited purchases and explicit exceptions |
| Evidence | Required evidence types, approved origins and maximum evidence age |
| Review criteria | Concrete conditions an invoice and purchase must satisfy |
| Asset and spending networks | The actual token and an immutable subset of advertised destinations |
| Money and validity | Lifetime budget, per-payment limit, one aggregate period budget and validity dates |

Enter amounts as exact decimal strings such as `"5"` or `"0.000001"`, with at most six decimal places. Currency symbols, commas, exponent notation and floating-point JSON numbers are invalid. Put numerical limits in the money fields. A policy has one aggregate period; simultaneous daily and weekly aggregate limits require a different policy arrangement.

Choose only assets and routes available in the live configuration. Native testnet USDC and synthetic TEST-USDT are different contracts. Mainnet USDT0 is restricted to local X Layer settlement and is unavailable on testnet. Prepared route lists do not establish live route readiness.

### 3. Review and activate the exact terms

Submit **Review policy**. GenLayer processes the saved draft asynchronously. Save its draft ID or bookmark `/agent-setup?draftId=<draft-id>` so you can return after closing the page.

Wait for the proposal result. **Edit inputs**, **My agents** and setup mode switches stay disabled while processing, including after a reload or network interruption. Keep the same proposal link to resume waiting.

A valid `PROPOSED` result can be ready for review even when GenLayer reports `UNDETERMINED` or finalized validator disagreement. The app uses the successful leader's returned terms, verifies the original input and exact structured guidance, and displays the missing consensus before activation. Review the full permission and explicitly accept it. This recovery does not submit another proposal transaction. If clarification is requested, edit the inputs and resubmit. If execution returned no valid terms, preserve its transaction link; the authenticated draft retains the original inputs for recovery. Payment evidence reviews and reviewer initialization still require successful finalized consensus.

Open **Read the full permission**. Check the asset, networks, limits, merchants, evidence requirements and criteria. Confirm that you approve those exact terms, then select **Activate agent** and approve the factory transaction in your wallet on the payment source chain. Save the transaction hash and vault address. If the page loses connectivity after confirmation, reconcile that transaction before attempting another activation.

The application registers the confirmed activation and the worker initializes the card's reviewer. Wait for reviewer readiness before issuing an agent credential. A finalized proposal alone does not create a funded, usable vault.

### 4. Fund the correct vault and save its key

Open **My agents**, select the agent and use **Fund vault**. Verify the card's vault address, payment chain and token contract before approving the transfer. Funding transfers the selected token directly from the owner wallet to that vault. The synthetic TEST-USDT card may offer **Mint test tokens**; that faucet does not mint native USDC.

Funding and lifetime spending permission are separate. A funded vault can still reject a purchase because of budget, validity, merchant or evidence restrictions.

Once the reviewer is ready, use **Issue API key**. Copy the key into the agent's secret manager before closing the dialog; it is shown once. Save the card ID and vault address separately. A testnet key starts with `ig_`; a mainnet key uses `ig_mainnet_`. The key authorizes requests for its card and cannot withdraw funds or change policy.

## Manage and recover an agent

Use the selected agent's controls and ledger in **My agents**.

| Control | Effect |
|---|---|
| Fund vault | Transfer the card's actual token from the owner wallet |
| Withdraw available funds | Return unreserved funds to the owner |
| Pause / Resume | Stop or resume spending within the existing immutable permission |
| Permanently revoke agent | Disable the vault permanently; it cannot be resumed |
| Cancel request | Cancel an eligible reserved request before payment or CCTP burn |
| Rotate API key | Invalidate the old key and show a new key once |
| Revoke API key | Invalidate agent credentials without withdrawing the vault balance |
| Retry reviewer initialization | Retry a failed reviewer deployment while preserving the vault and its history |
| Replace agent | Create a new vault with explicitly reviewed terms and accounting reset |

Owner vault controls require a wallet transaction. Key controls use the authenticated owner API. Check confirmed receipts and refreshed balances after each action. Key rotation or revocation causes the worker to cancel requests that have not burned or paid; completed transfers remain recorded.

Immutable permissions cannot be edited in place. A replacement starts with an empty vault and reset accounting. Review the replacement acknowledgement, revoke old credentials, reconcile reservations and burns, activate the replacement, then deliberately withdraw/redeposit available funds. Existing history and the old reviewer remain intact. See [reviewer replacement](PROTOCOL.md#owner-api-and-replacement).

A confirmed CCTP burn cannot be cancelled by pausing a card, revoking a key or changing an API status. Its budget is already consumed and the worker must recover the same message through destination delivery and acknowledgement.

### Read request states correctly

| State | Meaning and next action |
|---|---|
| `QUEUED` | Durably admitted; wait for the worker |
| `RESERVED` | Budget reserved; evidence processing can continue |
| `REVIEWING`, `AWAITING_FINALITY` | Wait for the actual GenLayer review/finality |
| `APPROVED` | Both gates allow the request; delivery is still pending |
| `BRIDGING`, `AWAITING_ATTESTATION`, `MINTING` | Recover the existing USDC burn through CCTP |
| `RETRYING` | A recoverable failure; keep the same operation ID |
| `PAID` | Verified delivery completed; reconcile its receipt |
| `BLOCKED` | Financial permission denied; review is `SKIPPED` |
| `REJECTED` | Finalized evidence review denied the purchase |
| `NEEDS_EVIDENCE` | The evidence failed preflight; inspect the reason |
| `EXPIRED`, `CANCELLED` | Terminal before payment/burn; inspect reservation release |

`reviewStage` independently reports `PENDING`, `COMPLETE`, `SKIPPED` or `FAILED`. HTTP `202`, an approval, a source burn and a submitted mint do not confirm delivery. Only `PAID` does.

Keep the request ID, exact input and stable business operation key when the page or agent times out. Poll the existing request. Do not create another purchase to recover a transport timeout.

## Connect your agent

### SDK integration

The SDK is source in this repository; it is not a published npm package. Import [packages/sdk/index.ts](../packages/sdk/index.ts) with TypeScript tooling, or vendor the complete SDK directory and use its browser-safe `client.mjs` entry point.

Configure `INTENTGUARD_BASE_URL`, `INTENTGUARD_PAYMENT_ENV` and `INTENTGUARD_API_KEY` in the agent's private runtime. Use the application origin as `baseUrl`, without appending `/api/v1`. Pin `expectedCardId`, `expectedReleaseId` and `expectedSourceCommit` when your deployment policy requires them. Revisit source/release pins after a deliberate release update.

```ts
import {IntentGuard, IntentGuardError} from "./packages/sdk/index";

const guard = new IntentGuard({
  baseUrl: process.env.INTENTGUARD_BASE_URL!,
  paymentEnvironment: "testnet",
  apiKey: process.env.INTENTGUARD_API_KEY!,
});

await guard.capabilities(); // Anonymous configuration and identity checks.
const {card} = await guard.me();

// Populate these values from an actual, authorized merchant invoice.
const payment = {
  recipient: "0x2222222222222222222222222222222222222222",
  amount: "0.000001",
  purchaseDescription: "Research dataset",
  justification: "Required for the approved research mission",
  category: "data",
  invoiceId: "REPLACE_WITH_ACTUAL_INVOICE_ID",
  evidence: [{url: "https://merchant.example/REPLACE_WITH_ACTUAL_INVOICE"}],
  destinationChainId: 1952,
};
const operationKey = "REPLACE_WITH_STABLE_BUSINESS_OPERATION_KEY";
// Persist exact payment and operationKey before submission.
const admission = await guard.request(payment, operationKey);
// Persist admission.id before waiting.
try {
  const result = await guard.wait(admission.id, {timeoutMs: 45000});
  if (result.status === "PAID") {
    // Reconcile the actual delivery receipt and amount.
  }
} catch (error) {
  if (error instanceof IntentGuardError && error.code === "POLL_TIMEOUT") {
    // Resume later with guard.get(admission.id).
  } else {
    throw error;
  }
}
```

The example's address, invoice and domain are placeholders. Replace them together with an actual approved merchant invoice. For legacy synthetic-token cards, omit `destinationChainId` if the card has no USDC settlement permission. For a USDC bridge, choose an advertised destination permitted by the card.

The invoice must identify the **source vault** as buyer and match the invoice ID, recipient, amount, purpose, freshness and actual delivery token/chain. For a bridge, the buyer remains the source vault while the invoice describes destination USDC. Evidence URLs must be approved public HTTPS sources; optional SHA-256 values bind fetched bytes. Agent credentials do not grant merchant invoice issuance.

The SDK checks deployment and card identity before payment admission. It refuses mismatched environments, assets, review profiles and unsupported destinations. Public explorer/config calls omit credentials.

### HTTP integration and idempotency

The agent API uses `Authorization: Bearer <agent-key>` for `GET /api/v1/me`, `POST /api/v1/requests` and `GET /api/v1/requests/{id}`. Payment submission requires `Content-Type: application/json` and a stable `Idempotency-Key` header. The API key selects the card; a request cannot select another card or asset.

An identical key and input returns the existing request. The same key with changed input returns `409 IDEMPOTENCY_CONFLICT`. After a lost submission response, resend the exact input with the same key. A new business operation requires reconciling the old one first.

Public reads can be made without credentials:

```sh
curl -fsS https://intentguard-tapeout.vercel.app/api/v1/config
curl -sS https://intentguard-tapeout.vercel.app/api/v1/health
curl -fsS https://intentguard-tapeout.vercel.app/api/v1/explorer/agents
```

Use the SDK or a secret-aware HTTP client for authenticated requests. Error responses carry `error.code`, `message`, `retryable` and `requestId`; retain the request ID when diagnosing failures. Respect `Retry-After` on rate limits or retryable failures.

### MCP integration

Install the checkout server's locked dependencies:

```sh
npm ci --ignore-scripts --prefix packages/mcp
```

Add this server to your MCP client's configuration, replacing the absolute checkout path and injecting the actual key through its secret/environment mechanism:

```json
{
  "mcpServers": {
    "intentguard": {
      "command": "node",
      "args": ["/absolute/path/intentguard/packages/mcp/src/cli.mjs"],
      "env": {
        "INTENTGUARD_BASE_URL": "https://intentguard-tapeout.vercel.app",
        "INTENTGUARD_PAYMENT_ENV": "testnet",
        "INTENTGUARD_API_KEY": "INJECT_FROM_SECRET_MANAGER"
      }
    }
  }
}
```

Read `intentguard://protocol`, `intentguard://openapi` and `intentguard://integration`. Tools cover config/health, the current agent, submission, polling, public records and bridge proof. `submit_payment` admits a real request against the configured card. The MCP server has no owner signing or merchant-admin authority. Restart it after deliberately rotating its credential. The [portable IntentGuard skill](../skills/intentguard/SKILL.md) also bundles the protocol and schemas.

## Local development

### Install the locked toolchain

Use Node **24.18.0** and pnpm **11.9.0**, matching CI and the Docker image. From your development directory:

```sh
git clone https://github.com/TS-mfon/intentguard.git
cd intentguard
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
npm ci --ignore-scripts --prefix packages/mcp
```

The root pnpm workspace installs the web application's shared dependencies. The MCP server has its own npm lockfile. The motion project has a separate toolchain described in [its README](../apps/motion/README.md).

### Start the web application

```sh
pnpm dev
```

Open `http://localhost:3000`. Without a complete explicit environment, the application renders an unconfigured local profile. This is useful for UI work; it does not provide a funded vault, database or live worker.

For a configured installation, copy [.env.example](../.env.example) to `apps/web/.env.local` and populate it privately. Next.js runs from `apps/web` and reads that app's env file. The root worker CLI does not automatically load the web application's env file. Do not replace an existing private env file unintentionally.

Keep configuration consistent:

- Local isolated work: `INTENTGUARD_MODE=local`, `INTENTGUARD_PAYMENT_ENV=local`, `XLAYER_CHAIN_ID=31337`, `MONGODB_DB=intentguard_local` and your local RPC. Contracts and service configuration are still required for mutations.
- A development client of a testnet installation: use an explicit testnet profile and that installation's verified addresses, dedicated development database and operator-owned configuration. Shared production data is not a disposable test fixture.
- A static client or SDK integration: point it at a verified hosted HTTPS API and use the advertised payment profile.

MongoDB must be reachable at `MONGODB_URI`. The checked disposable Docker fixture uses MongoDB **7.0.45**; see [packaging verification](production/PACKAGING-VERIFICATION.md) for the pinned fixture and kernel compatibility. A database connection alone does not establish valid deployment identity.

### Build and verify

```sh
pnpm typecheck
pnpm test
pnpm exec tsx scripts/verify-protocol-docs.ts
node tools/check.mjs circuit
pnpm build
pnpm --filter @intentguard/web start
```

`pnpm test` runs the TypeScript API/worker suite. The documentation verifier exercises schema/API/SDK consistency; it also needs the MCP dependencies installed above. Build and start use the production Next.js application on port 3000.

Additional checks have explicit prerequisites:

| Check | Prerequisite / coverage |
|---|---|
| `node tools/check.mjs evm` | Foundry v1.8.6; EVM contract tests |
| `node tools/check.mjs integration` | Foundry/anvil; real isolated API/worker/vault flow with a test-only GenLayer port |
| `pnpm test:genlayer` | uv, Python and cached genvm-linter/genlayer-test; this script uses offline uvx |
| `pnpm exec tsx scripts/agent-card-browser.ts` | Production build and Playwright Chromium; responsive layout and SVG/PNG exports |
| `pnpm exec tsx scripts/story-browser.ts` | Production build and Playwright Chromium; real WebGL/media, controls and recovery |
| `node tools/production/verify-packaging.mjs` | Docker; clean web serving and isolated durable worker retry |
| `node tools/production/verify-frontend.mjs` | Browser/build prerequisites; both static profiles and origin-bound owner login |

Install Chromium using `pnpm exec playwright install chromium`; Linux may also require Playwright's system dependencies. CI's [validation workflow](../.github/workflows/validate.yml) pins the full toolchain and runs `validate` and `packaging` jobs. Local fixture tests do not establish live semantic or mainnet acceptance.

## Deployment and operations

### Separate public configuration from secrets

Start with [.env.example](../.env.example), the live configuration schema and verified deployment manifests. Do not invent contract addresses to make readiness pass.

| Location | Configuration |
|---|---|
| API server | Explicit mode/payment chain; MongoDB API URI/database; `SESSION_SECRET`; public contract, circuit, review and origin pins; source/release identity |
| API worker wake | Server-only `GITHUB_WORKER_TOKEN`, `GITHUB_WORKER_REPOSITORY`, workflow and ref |
| Actions worker | Same environment/database and public pins; worker MongoDB URI; dedicated X Layer operator, review attestor and GenLayer operator secrets |
| Optional test merchant | Server-only merchant admin key and verified recipient/origin |
| Optional visitor sandbox | Server-only dedicated card ID, owner, key and durable request ceiling |
| Static browser bundle | Public API/frontend origins, payment environment and source identity only |

`SESSION_SECRET` must contain at least 32 characters. Never put database URIs, agent keys, merchant-admin keys or signing keys in `NEXT_PUBLIC_` variables. The Vercel API does not need blockchain signing keys; the worker signs using dedicated credentials. Environment files, `.local` journals and private artifacts are ignored by Git.

The active testnet worker variables include `INTENTGUARD_MODE`, `XLAYER_CHAIN_ID`, `XLAYER_RPC_URL`, `MONGODB_DB`, `APP_URL`, `PAYMENT_TOKEN`, both applicable factory addresses, gateway/attestor, TapeOut processor/circuit/beacon/implementation/netlist pins, interpreter/RPC, source/release identity and enabled destination RPCs. The exact mapping is in [worker.yml](../.github/workflows/worker.yml). Runtime readiness also verifies chain, contracts and database identity.

### Vercel API and frontend

Use the repository root as the Vercel project root. [vercel.json](../vercel.json) installs the frozen pnpm lockfile, builds `@intentguard/web` and serves `apps/web/.next`. Link the intended project, configure its private production environment and keep the canonical `APP_URL` consistent with login challenges and origins.

After checks pass and the source is committed/pushed:

```sh
vercel deploy --prod
```

Set `INTENTGUARD_SOURCE_COMMIT` to that release's full commit and use a matching `INTENTGUARD_RELEASE_ID`. These are public identity pins; update them consistently in the API and worker when releasing. Wait for Vercel `READY`, verify its source metadata and aliases, then check `/api/v1/config`, `/api/v1/health`, owner login, public cards and actual downloads. A successful build alone does not verify the running application.

For a separate frontend, set the canonical API `APP_URL`, `FRONTEND_URL` and explicit JSON array `INTENTGUARD_FRONTEND_ORIGINS`. The static builder supplies public browser origin/environment/source pins. Same-origin login uses an HttpOnly owner cookie; cross-origin login uses a ten-minute `Authorization: Owner <session>` held in memory. Agent Bearer authentication remains separate.

### GitHub Actions worker

The [testnet worker](../.github/workflows/worker.yml) runs on `main`, processes a bounded queue and continues unfinished work. Its five-minute schedule and manual dispatch are recovery paths. MongoDB leases serialize signing and preserve retry journals; workflow concurrency never cancels an active run.

Configure repository secrets `MONGODB_URI`, `XLAYER_OPERATOR_PRIVATE_KEY`, `REVIEW_ATTESTOR_PRIVATE_KEY` and `GENLAYER_OPERATOR_PRIVATE_KEY`, plus the exact public variables mapped in the workflow. Set Vercel's server-only wake token to a repository-scoped credential with Actions read/write. See [ACTIONS-WORKER.md](ACTIONS-WORKER.md) for wake coalescing, heartbeat, deadline and terminal-failure behavior.

Run the worker locally only with a dedicated installation's environment already exported, or explicitly load a private worker env file with Node:

```sh
node --env-file=.local/worker.env node_modules/tsx/dist/cli.mjs apps/worker/main.ts --duration-seconds 180
```

This processes real queued jobs using those credentials. The worker refuses an unconfigured profile or missing signing secrets. Do not run another program using the same signing accounts; database leases only coordinate IntentGuard's own execution.

### Docker and static frontend

[Dockerfile](../Dockerfile) has separate `web` and `worker` targets:

```sh
docker build --target web -t intentguard-web .
docker build --target worker -t intentguard-worker .
```

Inject private runtime env files when starting containers. The web target serves port 3000; the worker target processes the durable queue. Both use a pinned Node image and non-root runtime. Keep API and worker credentials separate and ensure the worker/database can reach the approved RPC and evidence services.

Generate a static testnet frontend from clean source:

```sh
node scripts/static-frontend.mjs --payment-environment testnet \
  --api-origin https://intentguard-tapeout.vercel.app --final
```

The output is `.local/static-frontend/out` with a source/file-hash manifest. Static assets require a separately hosted API and worker. Prepared bytes do not establish DeWEB publication; [hosting documentation](hosting/README.md) covers verified infrastructure, resumed uploads and gateway permissions. Paid mainnet deployment requires a current quote and explicit spending cap under [the release contract](production/REMEDIATION-PLAN.md).

### Verify a release and preserve recovery data

Require both GitHub validation jobs on the exact pushed source. Confirm the deployed config and health identify that source and environment. Verify the public aliases, responsive cards, transparent downloads, story playback and wallet flows.

Back up MongoDB records and deployment journals through your private operations process. Keep request IDs, exact input, idempotency keys, signed transaction journals and CCTP messages through retries. Do not repair a stuck request by deleting its reservation or transaction history. Follow [CROSSCHAIN.md](CROSSCHAIN.md) for burn/mint reconciliation and [release preparation](production/RELEASE-PREPARATION.md) for source-bound evidence.

## Troubleshooting

| Symptom | Check and action |
|---|---|
| App says unconfigured | Inspect `/config` readiness and explicit mode, chain, addresses, circuit pins, MongoDB and session secret. An empty `.env.example` cannot enable spending. |
| Login fails on one alias | Use the canonical application; verify the contacted API and frontend origin allowlist. Sign a fresh challenge for that origin/account. |
| Wallet account/chain changed | Reconnect the intended account and payment source chain, then log in again. |
| Proposal is pending | Save its draft link; check worker health, Actions queue and GenLayer transaction. Reopen the same draft. |
| Proposal failed or asks for clarification | Inspect the diagnostic/transaction and edit the preserved original inputs. Activate only reviewed finalized terms. |
| Reviewer failed | Use **Retry reviewer initialization**; preserve the existing vault and old transaction evidence. |
| API key was lost | Authenticate as owner and rotate/issue a key. The old plaintext cannot be recovered. |
| Funding does not appear | Check confirmed chain, vault and actual `card.token`; TEST-USDT and native USDC differ. |
| Purchase is `BLOCKED` | Read financial failures: funds, per-payment/period/lifetime limits, validity, merchant, paused/revoked state. |
| `NEEDS_EVIDENCE` | Match buyer vault, invoice ID, recipient, exact amount, token/chain, freshness, approved origin and optional hash. |
| `REJECTED` | Read finalized criteria and reason; a valid invoice does not override prohibited purchase terms. |
| Polling timed out or returned `503` | Retain the request ID and resume the same record after dependency recovery. |
| `409 IDEMPOTENCY_CONFLICT` | Compare the saved exact input; changed content cannot reuse the key. |
| `401` or `403` | Check key rotation, owner login expiry, card/environment and approved origins. Owner and agent auth have different scopes. |
| `429` | Respect `Retry-After` and retry the same operation without creating another payment. |
| CCTP has burned but remains pending | Inspect source receipt, message, Iris attestation, mint and acknowledgement; keep the same burn. |
| Proof returns `404 PROOF_UNAVAILABLE` | Older records may lack captured proof; consult their historical release evidence and transaction links. |
| Worker stops or health heartbeat is stale | Check Actions status, database access, RPC identity, dedicated account gas and secrets; restore the existing queue. |
| Offline GenLayer tests cannot resolve tools | Install/cache the workflow-pinned genvm-linter and genlayer-test versions with uv before using the offline script. |
| Browser check cannot start Chromium | Install Playwright Chromium and required Linux system libraries. |
| Container MongoDB fixture fails on a new kernel | Use the supported pinned fixture and retained diagnostics in [PACKAGING-VERIFICATION.md](production/PACKAGING-VERIFICATION.md). |

When reporting a problem, include the payment environment, source/release ID, public card/request/draft ID, HTTP error code, `requestId` and relevant public transaction links. Keep credentials and private journals out of the report.

## Further references

- [Protocol and recovery contract](PROTOCOL.md), [OpenAPI](openapi.json) and [SDK machine guide](../packages/sdk/integration.json)
- [Architecture](ARCHITECTURE.md), [contracts](CONTRACT.md) and [cross-chain receipts](CROSSCHAIN.md)
- [Testnet deployment history](TESTNET.md) and [Studionet setup incident](production/STUDIONET-SETUP-INCIDENT.md)
- [Remediation and release acceptance](production/REMEDIATION-PLAN.md), [security audit](security/2026-10-26-adversarial-audit.md) and [submission video](production/SUBMISSION-VIDEO.md)

Historical audit results and preparation reports have their stated scopes. Current-source CI and hosted verification do not certify mainnet deployment, zero semantic risk or customer adoption.
