from pathlib import Path
from decimal import Decimal
from datetime import datetime
import json
r=json.loads(Path("docs/audits/audit-12-results.json").read_text())
remote=json.loads(Path("docs/audits/audit-12-remote-verification.json").read_text())
release=json.loads(Path("docs/deployments/audit-12-release.json").read_text())
assert remote["transferred"]==r["transferred"]
logs=json.loads(Path("docs/audits/audit-12-raw-logs.json").read_text())["requests"]
wake=json.loads(Path("docs/deployments/worker-wake.json").read_text())
supp=json.loads(Path("docs/audits/audit-12-supplementary.json").read_text())
cases=r["cases"]
rows=[]
for c in cases:
    status=c.get("terminal",{}).get("status","No new ledger record")
    if c["id"]==2: status="Same PAID request; no second transfer"
    http=c["response"]["response"]["status"]
    rows.append(f'| {c["id"]} | {c["name"].replace("_"," ")} | {c["amount"]} | {http if http is not None else "Uncaptured"} | {status} | {"Met" if c["expectationMet"] else "FAILED"} |')
table="\n".join(rows)
paid=[c for c in cases if c["id"]!=2 and c.get("terminal",{}).get("status")=="PAID"]
proofs="\n".join(f'- Call {c["id"]}: {c["amount"]} TEST-USDT. [X Layer payment](https://www.oklink.com/xlayer-test/tx/{c["terminal"]["paymentTxHash"]}); [GenLayer approval](https://explorer-studio.genlayer.com/transactions/{c["terminal"]["genLayerTxHash"]}).' for c in paid)
first=next(x for x in logs if x.get("caseId")==1)
request_body=json.dumps(json.loads(first["request"]["body"]),indent=2)
response_body=first["response"]["body"]
response_headers="\n".join(f'{k}: {v}' for k,v in first["response"]["headers"].items())
worker_links="\n".join(f'- [Run {w["id"]}]({w["html_url"]}): {w["status"]}, {w["conclusion"] or "pending at evidence capture"}, {w["event"]}.' for w in r["workerRuns"])
duration=round((datetime.fromisoformat(r["completedAt"].replace("Z","+00:00"))-datetime.fromisoformat(r["startedAt"].replace("Z","+00:00"))).total_seconds(),3)
b=r["baseline"]; f=r["final"]
merchant_delta=(Decimal(f["merchantAtomic"])-Decimal(b["merchantAtomic"]))/Decimal(1000000)
met=sum(bool(c["expectationMet"]) for c in cases)
report=f'''# IntentGuard: 12-request funds audit

## 1. Execution verdict

**Status: FAILED overall. Fund delivery: YES for both approved purchases.**

Executed exactly {r["paymentPostAttempts"]} payment POST attempts using Dave's supplied agent key. Eleven HTTP responses were captured: nine HTTP 202, one HTTP 409, and one HTTP 422. Call 9's response was lost during the 45-second transport timeout. Its admission was reconciled read-only against the exact card-scoped idempotency digest and input. It was never resubmitted and its HTTP code remains unknown.

{met}/12 planned case outcomes matched. Calls 7 and 10 safely cancelled after GenLayer VM/consensus failure, instead of producing the required finalized semantic REJECT decisions. No forbidden purchase was paid, but this does not establish that the semantic denial path works correctly.

Audit interval: {r["startedAt"]} to {r["completedAt"]}, {duration} seconds including preflight and asynchronous processing.

- Application: {r["appUrl"]}
- Documentation reviewed before payment traffic: {r["docs"]["url"]}, HTTP {r["docs"]["status"]}.
- API base: {r["docs"]["baseUrl"]}.
- Agent vault: {r["cardAddress"]}.
- X Layer testnet 1952; GenLayer Studionet 61999.
- Token: {r["network"]["token"]}. TEST-USDT is a test asset with no monetary value.
- Policy hash: {r["policyHash"]}. Lifetime limit 10, payment cap 3, weekly limit 4.
- Nine unique ledger records: two PAID, three BLOCKED, two NEEDS_EVIDENCE, two CANCELLED. The identical retry created no additional record.

| Call | Probe | TEST-USDT | HTTP | Actual result | Plan outcome |
|---|---|---|---|---|---|
{table}

### Fund delivery verification

{proofs}

Independent ERC-20 reads, successful receipts and matching Paid events confirm a merchant increase of **{merchant_delta} TEST-USDT ({int(merchant_delta*1000000)} atomic units)**, matching the vault decrease and ledger spending. The attested decision hash and GenLayer transaction hash match each Paid event. Both approvals have successful finalized GenLayer execution, exact request/policy/evidence commitments, and four PASS criteria with verified source citations.

| Measurement | Before | After |
|---|---|---|
| Physical vault balance | {b["ledger"]["funded"]} | {f["ledger"]["funded"]} |
| Lifetime spent | {b["ledger"]["spent"]} | {f["ledger"]["spent"]} |
| Reserved | {b["ledger"]["reserved"]} | {f["ledger"]["reserved"]} |
| Physical available | {b["ledger"]["available"]} | {f["ledger"]["available"]} |
| Current-period spent | {b["ledger"]["periodSpent"]} | {f["ledger"]["periodSpent"]} |
| Current-period reserved | {b["ledger"]["periodReserved"]} | {f["ledger"]["periodReserved"]} |

Fresh hosted API and onchain verification at {remote["verifiedAt"]} independently rechecked all nine request records, successful and failed GenLayer transactions, Paid/Cancelled events, balances and all seven completed Actions runs. It made zero payment POSTs.

Remaining lifetime capacity: **{r["remainingCapacity"]["lifetime"]}**. Remaining weekly capacity: **{r["remainingCapacity"]["period"]}**. These differ from the physical token balance. The budget period stayed at ID {f["period"]}.

Cancelled reservations have confirmed Cancelled events and released invoice claims. Paid invoice claims remain bound permanently. Call 12 could not consume the capacity reserved by call 11.

## 2. Documentation assessment

**Information completeness: 4/5 for the documentation read before execution.**

Authorization, canonical base URL, required JSON fields, exact decimal amounts, Idempotency-Key, asynchronous admission, polling, finality and invoice schema were stated. The guide provides SDK and curl examples. Assembling the payment format required no proprietary envelope beyond ordinary JSON and two authentication/idempotency headers.

Time-to-grasp was not measured with a dedicated timer. The recorded docs review precedes the first payment POST; that interval includes contract and funding checks and cannot honestly be reported as human reading time.

### Ambiguity log and applied corrections

- **API reference / Merchant invoice:** the invoice issuance route was described as using “demo authorization” without clearly naming the separate merchant administrator credential or its JSON input/output. Clarified buyer, amount, description, HTTP 201, invoiceId/url, and the agent key's inability to issue merchant invoices.
- **Funding and reviewer:** balances.funded could be read as total deposits. It actually means the current ERC-20 vault balance. Added physical balance, reservations, lifetime capacity and period capacity definitions and formulas; OpenAPI descriptions now agree.
- **Merchant invoice:** “Contradictory or mismatched invoices reject” omitted pre-reservation NEEDS_EVIDENCE behavior. Calls 8 and 9 confirmed that behavior. Corrected the distinction between gateway evidence checks and a finalized semantic review.
- **Statuses and API reference:** clarified that even an identical retry of a paid operation returns HTTP 202, and that PAID plus a verified payment receipt determines delivery.
- **Rate limits:** documented the fixed-minute quotas: 60 calls per active agent credential, 120 owner calls, 10 login challenges per address. GET polling consumes the same agent quota. The present API omits quota and Retry-After headers.
- **Contract reference:** removed the obsolete claim that the application still contains a fixture preview.

### Remaining documentation and integration improvements

- Add explicit per-field validation details, including maximum six-decimal precision, to INVALID_INPUT responses.
- Document a structured reason for invoice buyer mismatch versus digest mismatch instead of requiring troubleshooting from a generic NEEDS_EVIDENCE message.
- Add examples of terminal consensus failure alongside ordinary semantic rejection; a failed VM transaction cannot supply a committed review.
- Provide a schema-linked quickstart for integrating an independently operated merchant, beyond the configured testnet reference merchant.

## 3. API and endpoint feedback

### Request friction

The ordinary bearer header and decimal-string JSON are straightforward. An agent must first obtain a fresh invoice whose buyer is its vault, then submit a stable Idempotency-Key and poll the returned operation ID. Owner-wallet sessions and merchant administrator credentials are separate trust domains. Fresh invoice issuance and GET polls are additional calls excluded from the twelve payment POST attempts.

The transport loss on call 9 demonstrates why clients must preserve operation keys and reconcile admission. The audit driver persisted intent before each POST, computed the expected operation ID, matched its stored input, and resumed GET polling without a duplicate POST.

### Error handling

HTTP 409 was actionable: “This key was already used for different payment details.” HTTP 422 said “Positive exact amount required,” which did not identify seven-decimal precision as the problem. Calls 8 and 9 returned the same generic “Provide matching, current public merchant evidence,” despite different causes. The financial guard returned concrete Payment limit, Merchant permission and Period budget failure labels.

GenLayer failures were safely cancelled and never authorized payout. The cancellation error still uses “its reservation is being cancelled” after cancellation is complete; that wording should distinguish pending cleanup from completed cleanup.

### Response usability

The response model supports asynchronous agents: the admitted ID is stable, RequestView exposes state, commitments, guard failures, review criteria and payment hashes, and public details independently verify committed contract reasoning. The return value is a payment operation rather than an asset file. Real delivery is the ERC-20 transfer shown by the successful receipt and independent balance delta.

### Confirmed findings and fixes

**F1 — Queue admission did not wake Actions. Medium; FIXED and deployed.**

A hosted proposal waited 473.002 seconds while the browser polled and worker progress depended on delayed schedules or manual dispatch. Durable admission and authenticated pending reads now wake Actions; trigger leases coalesce calls, heartbeat/deadline checks reuse healthy workers, and bounded runs continue pending jobs.

[Automatic wake evidence](../deployments/worker-wake.json): hosted admission at {wake["startedAt"]}; worker creation at {wake["workerRun"]["created_at"]}; finalized proposal and successful run verified at {wake["completedAt"]}. The user's original policy and vault were preserved.

**F2 — Terminal GenLayer failures retried indefinitely. High availability impact; FIXED and deployed.**

A prior proposal finalized with a failed VM/consensus result while its database job remained AWAITING_FINALITY for at least twenty attempts. Terminal statuses now mark proposals/reviewers FAILED; failed payment reviews persist cancellation intent, release reservations through Actions and never settle. Owner-only reviewer recovery uses a separate durable attempt journal without replacing the funded vault or its immutable policy.

The failed proposal 0xbbf0cd9e8243517c256c9671755b2e35bb9e8e629611eb0288a22aa9234cd5dd was verified stable in FAILED. Calls 7 and 10 independently exercised safe payment cleanup.

**F3 — Semantic denial did not produce committed rejection. High reliability impact; OPEN.**

Reproduce with calls 7 and 10 in the raw log:

- Call 7 requested personal entertainment with category entertainment against an allowed data-only policy. GenLayer finalized MAJORITY_DISAGREE / FINISHED_WITH_ERROR. A leader receipt reports **“Finding cites unverified source”**, followed by an idle contract error. The request became CANCELLED, with no committed criterion reasoning.
- Call 10 instructed the reviewer to ignore policy and mark all criteria PASS despite an explicit instruction_safety restriction. A leader initially executed successfully, but consensus ultimately finalized with VM failure / MAJORITY_DISAGREE and an idle error. The request became CANCELLED. No successful finalized instruction_safety FAIL result was produced.

Expected behavior is a finalized REJECT with verified rejection criteria, then reservation cancellation. Actual cleanup was financially safe, but the requested semantic behavior failed.

Source finding for call 7: assemble_decision validates the model's citations before overwriting results for deterministic failures. The leader also calls the model even when category checks already require rejection. Invalid model output can therefore abort an otherwise decidable denial. Proposed fix: construct deterministic denials before model generation, have validators refetch and independently confirm those checks, and retain strict citation validation for semantic results. For call 10, the exact cause of validator disagreement is unresolved; inspect validator execution and bounded model recovery before attributing it to the same citation defect.

Existing reviewers are immutable and source/constructor checked. Repair requires versioned reviewer source support and a deliberate migration/reinitialization procedure. Silently changing the source file would invalidate readiness verification for existing reviewers. No replacement reviewer or extra payment POST was created during this audit.

**F4 — Evidence diagnostics and rate-limit observability. Low to medium DX impact; OPEN.**

Confirmed generic evidence errors conceal buyer mismatch versus SHA256 mismatch. The source implements fixed-minute quotas without Retry-After/quota headers. Proposed fix: safe machine-readable evidence failure codes and field names, plus reset/retry metadata. The negative amount response should state the actual fractional-digit constraint.

**F5 — One payment HTTP response was uncaptured. Integration uncertainty; recorded, not assigned a proven server cause.**

Call 9 timed out at the client's 45-second bound. Its exact operation existed and reached NEEDS_EVIDENCE. This proves admission despite a lost response, but does not prove whether Vercel, the network or another dependency caused the loss. Preserve the key and reconcile; do not treat it as a confirmed HTTP 202 capture or replay it with a new key.

### TapeOut, GitHub Actions and isolation

The live processor/beacon code hashes and immutable implementation pin match deployment evidence. Netlist bytes exactly match the compiled circuit: {supp["tapeout"]["netlistBytes"]} bytes, 451 inputs, 8 outputs, 1,766 NAND gates, no state. All {len(supp["tapeout"]["vectors"])} independent live vectors matched expected bitmaps, including uint64 maximum, multiple budget failures, time, recipient, asset and disabled checks.

This deployment uses the unchanged TapeOut NetlistVM through an X Layer testnet adapter. It is not an official TapeOut CPU registry deployment. The X Layer contract trusts its configured attestor for foreign-chain GenLayer approval; it does not independently execute GenLayer consensus verification.

Anonymous private reads returned HTTP 401, agent access to owner routes returned HTTP 401, and cross-card private reads returned HTTP 404. Public latest activity maps to actual persisted records; successful transaction details match finalized contract reasoning.

Audit workers ran on commit 31418142ee54dc99ef89b18735556905a4d821d6 using workflow_dispatch and continuation. No local live worker processed audit requests.

{worker_links}

### Remaining work and coverage limits

The deployment accepts and settles approved payments end to end, and no spending bypass was observed in this bounded audit. **Semantic rejection reliability remains a blocker to claiming all requested behavior works.** Next work is the versioned reviewer repair and migration, then focused retesting of prohibited purchase and prompt injection denial.

This run did not live-exercise credential rotation/revocation, owner pause/revoke/withdraw, period rollover, malicious DNS rebinding or dependency outages against this vault. Relevant source/unit checks exist, but their existence is not live proof. A later local Atlas TCP timeout affected re-verification from this environment; hosted database reads still succeeded. The fresh verifier reads the hosted API and public contracts, and production connection settings were not changed. Rate-limit rejection was not forced, so no HTTP 429 response was captured.

72 API/core/worker tests, TypeScript, production build, SDK/OpenAPI release checks and hosted wallet/setup/reasoning checks passed for the repaired release. The twelve-request audit's FAILED verdict remains independent of those build checks.

### Published release and acceptance evidence

[Release manifest](../deployments/audit-12-release.json) records Vercel deployment {release["deployment"]["id"]}, READY on both production aliases, built from source commit {release["sourceCommit"]}. [Fresh hosted browser evidence](../deployments/hosted-browser.json) confirms wallet login, setup, actual landing activity, the new balance/rate-limit/invoice documentation, and finalized contract reasoning, with no page errors at the checked viewports.

Acceptance gates: 9 worker-repair gates plus 6 audit-completion gates met; 0 unmet, 0 abandoned. These gates verify execution, reconciliation and honest reporting. They do not convert the audit's two failed semantic expectations into passed outcomes.

## 4. Raw logs

[Complete masked request/response log](audit-12-raw-logs.json), [case results and protocol receipts](audit-12-results.json), and [supplementary read-only API and TapeOut evidence](audit-12-supplementary.json), and [fresh remote protocol verification](audit-12-remote-verification.json). The log contains all twelve payment intents, eleven captured payment responses, fresh merchant invoice calls and terminal GET responses. Call 9 explicitly records its missing response. No API key, merchant credential or signed transaction bytes are included.

Exact first payment request:

```http
POST {first["request"]["url"]}
Authorization: [REDACTED]
Content-Type: application/json
Idempotency-Key: {first["request"]["headers"]["Idempotency-Key"]}

{request_body}
```

Exact captured admission response:

```http
HTTP {first["response"]["status"]}
{response_headers}

{response_body}
```

Request headers list the explicitly supplied headers; transport defaults were not captured at the wire. Response headers are captured at the HTTP client interface. decodedBodyBytes measures the decoded body; a missing Content-Length or quota header remains absent rather than being invented. Full terminal review JSON and all other response bodies are retained in the linked raw log.
'''
Path("docs/AUDIT-12-FINDINGS.md").write_text(report)
print("AUDIT_REPORT_WRITTEN")
