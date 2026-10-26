# IntentGuard GenLayer contracts

These are new standalone contracts. Each Python source includes its own validation
helpers because GenLayer deploys one source file and one contract class per VM.

PermissionInterpreter(operator) exposes propose(draftId,inputJson) and
get_draft(draftId), returning the exact DraftResult as a JSON string.
inputJson is {description,guidance?:partial Policy}. Explicit guidance remains
exact; the independent validator also assesses the original prose, budgets,
restrictions, ambiguity and completeness. get_draft_input_hash(draftId) returns
SHA-256 of canonical input, and get_operator() returns the GenLayer Address.

PurchaseReviewer(operator,policyJson,policyHash) exposes
review(requestId,requestJson,evidenceJson) and get_review(requestId), returning
the exact ReviewDecision as a JSON string. get_policy_hash() and get_operator()
support deployment verification. requestId is lowercase 0x hex32.
The canonical request is the shared CanonicalRequest, including original amount
and evidence references. evidenceJson is the snapshot array, not a wrapper.
Hashes are SHA-256 of recursively sorted compact UTF-8 JSON; UTF-16 key order
matches the TypeScript adapter and original array order is retained. Money uses
positive uint64 integers in six-decimal atomic units; decimal strings have at
most six fractional digits and are never parsed as floats.

All writes are operator-only. Both IDs store an immutable payload commitment:
exact replay returns the stored result and changed input reverts. Owner policy
has no mutation method. The first reviewed request binds its reviewer instance
to cardId, cardAddress and owner. The worker must allocate one reviewer per
card and verify its operator and policy commitment before accepting requests.

The leader and every validator independently fetch the original HTTPS URLs.
Each snapshot must match its original declared hash and byte hash, and each
HTTP 200 body must match that committed byte SHA-256. Only approved origins
are fetched. An invoice must come from the payee's approved merchant origin
and match buyer card address, recipient, token, configured chain (1952 on the hosted testnet), invoice ID and exact
amount; issuance, expiry and age are verified using consensus transaction time.
Changed/contradictory evidence yields REJECT. Inaccessible, stale, future-dated
or missing evidence yields NEEDS_EVIDENCE. Byte identity does not establish
that every merchant assertion is independently true.

Version 2 handles deterministic permission failures and missing evidence before
model evaluation. Validators reproduce those outcomes without an LLM. Semantic
reviews call GenLayer's model, even for a small purchase. The model evaluates purpose, task, prohibitions, exceptions, products,
required evidence types and each criterion. Only every criterion PASS permits
APPROVE. Validators refetch evidence, independently evaluate all criteria, and
check substantive fidelity of the proposed reasons/citations. Evidence and
agent prose remain untrusted data in both prompts. No amount threshold permits
automatic approval.

Limits: 16 KiB draft input/request, 32 KiB policy/model output, 8 evidence URLs,
64 KiB per UTF-8 source and 128 KiB total source content. Sources must use
public DNS HTTPS URLs on port 443 without credentials or fragments. Origins
are root HTTPS origins. The pinned SDK web response exposes status, headers
and body; it does not provide independently inspectable resolved IP/final URL
metadata. The gateway must additionally enforce its public-network fetch
policy and reject redirects before snapshotting.

Schemas are exported by genvm-lint into permission_interpreter.schema.json and
purchase_reviewer.schema.json, as raw schema objects. SDK 1.1.8 decoded
transaction callData and constructorArgs are Maps: callData contains method,
args and optional kwargs. A positional review has three exact string args.
The adapter must require expected sender/recipient, leaderOnly:false,
FINALIZED (7), majority agreement and FINISHED_WITH_RETURN (1), validate exact
transaction arguments, and read using transactionHashVariant:'latest-final'.
An ordinary EVM receipt or ACCEPTED GenLayer transaction is insufficient.

Verification uses the pinned real SDK in genlayer-test direct mode. The test
fixtures require GenVM v0.2.16's official universal artifact and verify its SHA256;
they do not follow the incompatible latest-release artifact name. Model and
web outputs are fixtures. Direct mode runs leaders without consensus by
default, so tests explicitly run captured validators and demonstrate rejected
valid-shaped but false budgets/approvals, contradictory independent evidence,
commitment tampering and criterion disagreement. Positive controls exercise
validator agreement. Pickling checks exercise the actual nondeterministic
closure serialization. These tests establish contract behavior, not a live
network deployment or live model performance.

Official references:
- https://docs.genlayer.com/developers/intelligent-contracts/introduction
- https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism
- https://docs.genlayer.com/developers/intelligent-contracts/features/calling-llms
- https://docs.genlayer.com/developers/intelligent-contracts/features/web-access

Run node tools/check.mjs genlayer from the project root. The four implementation
passes covered full delivery, substantive validator/domain review, integration
and adversarial defects (including JS Unicode canonicalization), then SDK/schema
and documentation polish.

## Version 4 settlement profile and control preflight

New cards use `versions/purchase_reviewer_v4.py`. The constructor takes seven
explicit positional arguments:

```text
operator, policyJson, policyHash, chainId, token, settlementJson, profileJson
```

`settlementJson` is canonical JSON with
`{version:2,paymentEnvironment:"mainnet"|"testnet",asset:"USDC"|"USDT0",destinationChainIds:[sorted unique IDs]}`.
`profileJson` is canonical JSON with
`{version:4,paymentEnvironment:"mainnet"|"testnet",reviewEnvironment:"testnet"}`.
The two payment environments must agree. Mainnet payments bind X Layer196
and the official native token; testnet payments bind X Layer1952 and native
testnet USDC. USDT0 supports mainnet X Layer settlement only. USDC admits only
the fixed source and ten EVM destinations from the accepted plan, within the
owner's immutable subset. Destination chain, domain and native token must match
the invoice and settlement hash. No omitted profile, legacy settlement object,
cross-environment destination or synthetic USDC is accepted by V4.

The registry is a list of candidates from the official issuer tables, not live
deployment evidence. API deployment tooling must separately verify issuer
relationships, RPC chain identity, bytecode, fees and readiness before enabling
a route. The reviewer does not turn an unverified route into an enabled route.

Getters include `get_version()`, `get_settlement_profile()`,
`get_settlement_profile_hash()` and existing chain/token/policy/settlement
getters. Request commitments retain all route fields and include the V2
settlement hash. Earlier reviewer sources and existing hashes are preserved.

Deterministic permission or invoice contradictions yield REJECT without an
LLM. Missing proof yields NEEDS_EVIDENCE. Explicit instructions in agent prose,
public evidence or decoded invoice descriptions that try to override policy,
budget, recipients, evidence checks, expiry or validator roles yield
NEEDS_EVIDENCE when no deterministic rejection already applies. The scan
normalizes Unicode compatibility forms and removes format characters; decoded
JSON descriptions are checked so Unicode escapes cannot hide the same marker.
This is a conservative control marker check. It can require replacement of
otherwise useful evidence containing quoted attack instructions, and does not
prove detection of arbitrary paraphrases, encodings or languages.

The semantic validator first assesses original policy and refetched evidence
without seeing a leader proposal. Only after its criterion statuses agree does
a separate fidelity evaluation assess the leader's reasons and citations.
Both evaluations must pass. Every agreed result is revalidated for complete
criterion IDs, statuses, verified citations and exact commitments before
persistence. A small payment never skips semantic review.

Run `node tools/production/verify-reviewer.mjs` from the repository root.
The verifier pins genvm-linter0.11.0, genlayer-test0.29.2 and the existing
SDK0.2.16 artifact digest, checks the published V4 ABI against extracted schema,
and executes the old and new direct suites. Model/web responses are adversarial
fixtures. These checks establish implementation behavior; fresh live GenLayer
testnet deployment, validator consensus and two adversarial audit rounds remain
mandatory release gates. This work is an internal review, not third-party or
TapeCode certification.
