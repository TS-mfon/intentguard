# Public testnet sandbox

The sandbox sends genuine requests through IntentGuard's existing agent admission, durable worker, numerical guard and finalized GenLayer evidence review. It uses a **dedicated owner-authorized native-USDC card on X Layer testnet1952**, settling locally only. Review remains GenLayer Studionet61999 testnet. Testnet tokens have no monetary value. A request can remain pending, fail, or take minutes; the UI must display its actual recorded outcome. `202` and expected scenario labels do not certify payment.

The visitor never receives the real agent API key or an owner session. The API key stays in `INTENTGUARD_SANDBOX_API_KEY` on the server. An anonymous visitor gets an origin-bound HMAC capability with a one-hour lifetime and stores it in memory. Polling exposes only requests tied to that visitor and the configured dedicated card. Public transaction links remain available after the ephemeral visitor session expires.

## API contract

| Endpoint | Input/authority | Result |
|---|---|---|
| `GET /api/v1/sandbox` | Approved application origin | Actual card/policy/readiness, four scenarios, session and global limits; `enabled:false` when configuration, policy, credential, card or allowance is unavailable. |
| `POST /api/v1/sandbox/session` | Approved `Origin`, JSON `{}` | `201` with `visitorToken`, `expiresAt` in epoch milliseconds and five-request allowance. |
| `POST /api/v1/sandbox/requests` | `Authorization: Sandbox <visitorToken>`, `Idempotency-Key` of1–64 letters/numbers/underscores/hyphens, JSON `{"scenario":"permitted"}` | Actual persisted request ID/status and public record link; `202` means admitted, not paid. |
| `GET /api/v1/sandbox/requests/<id>` | Same visitor capability | Existing actual request, guard/review/receipt state and scenario, restricted to this visitor. |

The four scenario IDs are `permitted`, `blocked`, `prohibited` and `wrong-buyer`. The server constructs recipient, amount, chain, purpose and current invoice; arbitrary payment details, URLs, chains, recipients or credentials are rejected. Sub-limit requests use **0.000001USDC**. The blocked example asks for **0.010001USDC**, exceeding the immutable0.01USDC per-payment limit. Wrong-buyer evidence identifies the sandbox owner instead of the card; normal requests identify the actual vault.

Expected outcomes are PAID, BLOCKED, REJECTED and NEEDS_EVIDENCE respectively. They are educational expectations, never hardcoded outcomes. A different actual result remains visible and must be investigated. Successful finalized semantic approval and an independently verifiable source transfer are still required for PAID.

## Dedicated card and private configuration

The reviewed policy has name **IntentGuard public sandbox**, lifetime ceiling1USDC, per-payment0.01USDC, period ceiling0.1USDC/86400seconds, one approved protocol merchant, sole approved canonical API origin, native-USDC settlement verification purpose, and explicit prohibition of personal data for advertising. No exceptions are allowed. Its immutable destination subset contains1952 only. Both current legacy USDC and verified settlementV2 testnet profiles are accepted; no mainnet or cross-chain sandbox route is allowed.

Create this **new dedicated** card using the ordinary owner draft, exact policy review, activation, registration, reviewer-readiness and funding flow. Do not repurpose a customer's card or the historical audit card. The sandbox marker is applied only after independently reading its actual activation and reviewer identities.

```sh
node node_modules/tsx/dist/cli.mjs scripts/sandbox-bootstrap.ts plan --output .local/sandbox-plan.json
```

Run with the existing explicit testnet environment and configured `DEMO_MERCHANT_RECIPIENT` and `APP_URL`. The plan writes exact policy/settlement JSON and an implementation checklist, with no transaction, signature or key. The owner reviews finalized terms before activation. **0.001native testnet USDC** is enough to cover the default gateway's maximum admitted sub-limit transfer amount; deposits require the owner's separate action.

After the actual card is READY, set its selected owner in `INTENTGUARD_SANDBOX_OWNER` and inspect this binding command:

```sh
node node_modules/tsx/dist/cli.mjs scripts/sandbox-bootstrap.ts bind --card-id <actual-card-id> --owner <actual-owner> --output .local/sandbox-agent.env --acknowledge-dedicated-testnet-card
```

Binding reads and verifies the current dedicated policy, actual EVM activation and finalized reviewer. It issues/rotates only that dedicated card's API key, writes a new ignored file with mode600, and sets its database sandbox marker. It sends no onchain transaction and signs no message. Existing private files are never overwritten. The output contains `INTENTGUARD_SANDBOX_CARD_ID`, `INTENTGUARD_SANDBOX_OWNER`, `INTENTGUARD_SANDBOX_API_KEY` and `INTENTGUARD_SANDBOX_MAX_REQUESTS=30`. Transfer these variables through the hosting secret mechanism; never use `NEXT_PUBLIC_` or commit the file. `SESSION_SECRET` must remain configured separately.

## Admission and operational limits

- Five distinct preparations per one-hour visitor session; five submissions per minute for that visitor. Reusing one unchanged idempotency key returns the same actual request and retains immutable invoice content. A changed scenario conflicts.
- Six new preparations per minute across the card. Admission has a durable30-second lease, stable request identity and recoverable immutable invoice; concurrent retries cannot create another request.
- A durable ceiling of **30preparations per dedicated card**, configurable explicitly from1 through100. The slot ceiling survives key rotation and process restarts. Slots have no TTL and must not be cleared casually. A preparation retains its slot across failed admission retries; the visible limit is an allowance, not a count of successful payments.
- At30preparations, the maximum total admitted sub-limit transfer amount is **0.00003USDC**; at the hard100 ceiling it is0.0001USDC. The over-budget example remains blocked by the immutable numerical guard. This bound does not estimate review/RPC/worker costs.
- Session creation allows ten/minute per origin and five/minute per trusted client-IP bucket. Public config and visitor polling have separate bounded rates. Vercel's overwritten trusted IP header is used only under its runtime flag; ordinary user-supplied forwarding headers are ignored. Unknown clients share a conservative bucket. Global card admission remains bounded even if a client changes identity.
- Visitor sessions and bindings use the existing `rate` collection TTL. Permanent card allowance slots omit TTL. Actual requests and immutable invoices retain their normal historical records.

Pause the dedicated card or revoke its key to stop new submissions; existing visitor-scoped records remain readable without requiring a live RPC. Rotating the configured key invalidates old visitor capabilities, but public record links remain. Changing mainnet environment, merchant, token, destination, numerical limits or permission fields fails closed. Filling the allowance displays an unavailable state; it must not be reset automatically or silently bypassed.

Local tests use isolated stores and chain/reviewer fixtures to verify the real admission/worker paths, with positive and negative controls. They are **implementation evidence**. Live bootstrap, hosted anonymous admission, finalized review and independently verified payment receipts are separate release evidence owned by the driver. No live sandbox card, user or payment is claimed by this document alone.

## Dedicated testnet deployment, 2026-10-30

The dedicated card has completed finalized permission proposal, activation, reviewer deployment, private credential binding and a 0.001 native-testnet-USDC deposit. Hosted scenario acceptance is a separate check.

| Identity | Verified value |
|---|---|
| Card ID | `0xe199f50dcce9437b3431fd161759c6cce6563c5f070135c04e03445b8c4b4366` |
| Vault, X Layer testnet1952 | `0x3C652BCa51252dc72BF4eE32205cD10AEE97D5c5` |
| Policy hash | `0x02fa136bb2c7f6b46acf2c4e21b9c146a75371559dd9e320b0de0dd3aa7bcdea` |
| Finalized PROPOSED transaction | `0xfb25f39ef1dd678708743785569abb687792577f0969b215ccc38197f4a59df6` |
| Activation transaction | `0x12de7f99a696fa679767709bfe239ff086ccbfc539f78d1b12a220f4f65981c7` |
| READY Studionet reviewer | `0x2c2a05325f2B0Fe0774532aF9D12180A64647E00` |
| Funding transaction | `0xc667e00041aa6c2f8f6b169f96e73bae25389fea1cdf68146f8bb5bbb6a145a6` |

The first setup attempt returned finalized clarification; its draft and receipt remain archived. The revised reusable permission explicitly supplies invoice amount, invoice ID and buyer vault at purchase time. The private key remains server-only; no credential appears in this deployment record.

`scripts/sandbox-hosted.ts --execute` admits four genuine anonymous scenarios once, saves their actual IDs, checks a fresh mobile browser's numerical denial within60seconds, and waits for real outcomes. `--verify` rechecks the saved public records and finalized reasoning without admitting a request. A PAID result additionally requires an independently decoded one-unit native-USDC Transfer from this exact vault on chain1952. These four educational scenarios do not replace either full live semantic/reliability audit.
