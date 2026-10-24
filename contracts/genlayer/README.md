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
and match buyer card address, recipient, token, chain 196, invoice ID and exact
amount; issuance, expiry and age are verified using consensus transaction time.
Changed/contradictory evidence yields REJECT. Inaccessible, stale, future-dated
or missing evidence yields NEEDS_EVIDENCE. Byte identity does not establish
that every merchant assertion is independently true.

Every review calls GenLayer's model, even for a small purchase or deterministic
failure. The model evaluates purpose, task, prohibitions, exceptions, products,
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

Verification uses the pinned real SDK in genlayer-test direct mode. Model and
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
