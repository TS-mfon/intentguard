# Commercial preparation and pilot protocol

Status: **PREPARATION_NOT_CUSTOMER_VALIDATED**. No interviews have been conducted, pilots started, willingness to pay measured, retention measured or outreach sent. This is a concrete research and pricing plan, not customer-validation evidence. The complete R24 live requirement remains unmet.

## Initial customer and paid problem

Start with research and operations teams whose autonomous agents repeatedly purchase API access, datasets or other digital services with stablecoins. Their recurring decision is whether a purchase fits the human mandate and whether the merchant's evidence supports it. The owner wants enforceable numerical permission and a readable audit trail while delegating individual purchases.

The initial product offers one immutable funded vault per agent, card-scoped credentials, independent evidence review, idempotent settlement and public/owner receipts. The owner keeps funding, withdrawal, pause, revocation and key rotation. Intended willingness-to-pay drivers are fewer manual approvals, explicit loss bounds and easier reconciliation; their benefit and time saved are unmeasured.

Alternatives to examine in interviews: a narrowly permissioned smart wallet, an internal approval queue, card/payment infrastructure and manual stablecoin transfers. Ask customers to compare their current workflow with an actual purchase, including transaction/finality delays and evidence collection, before stating that IntentGuard is better.

## Measured historical behavior

The archived [live audit](audits/cctp-live-results.json) records actual native-USDC testnet requests. [Independent verification](audits/cctp-independent.json) verifies eight planned cases, including three delivered payments on X Layer1952/Base84532/Arbitrum421614. Testnet tokens have no monetary value. A refused mainnet destination and an idempotent retry are cases, not additional delivered payments.

Elapsed time below is `result.updatedAt - result.createdAt`, measured in seconds from each saved operation's admission to its recorded terminal update. It includes runner scheduling, consensus and bridge recovery, and excludes earlier failed attempts recorded separately. These six observations are not a production SLA, population percentile or mainnet-cost estimate.

| Record | Terminal status | Delivery chain | Elapsed seconds | Earlier failed attempts |
|---|---|---:|---:|---:|
| xlayer | PAID | 1952 | 101.164 | 1 |
| base | PAID | 84532 | 1215.902 | 0 |
| arbitrum | PAID | 421614 | 1514.578 | 0 |
| limit | BLOCKED | 84532 | 38.014 | 0 |
| prohibited | REJECTED | 1952 | 236.020 | 0 |
| evidence | NEEDS_EVIDENCE | 84532 | 87.117 | 0 |

The successful historical direct payment took 101.164seconds, Base1215.902seconds and Arbitrum1514.578seconds. Demonstrate existing verified records within the three-minute film; do not imply a new cross-chain purchase finalizes within the film duration. Timing a novice to a public record is a separate unperformed study; the first-use target remains60seconds.

The current service charges no implemented protocol fee. Recorded mainnet database preparation has zero incremental recurring cost on the existing free cluster, zero funded financial records and an unbound release identity. It does not establish a production capacity/cost forecast or funded-state recovery. Actual mainnet gas, official TapeOut deployment/hosting, GenLayer production review prices, storage, API and support costs remain unmeasured or unresolved. Follow the separate release quote/cap process before spending.

## Pricing and unit-economics hypotheses

Illustrative hypothesis: **USD49 per team/month** for500 payments, plus an optional **10 basis point** settled-payment fee after real demand is measured. Neither billing nor that fee is implemented. There are no paying users or measured willingness-to-pay results.

For a deliberately explicit service-borne scenario, assume USD0.01 gas and USD0.03 review cost per payment, USD10 monthly infrastructure and USD5 support allocation per team. All four inputs are assumptions. At500 payments this gives USD35 cost, USD14 contribution and28.5714% contribution margin against the hypothetical USD49 plan, before acquisition, failure/retry, tax or overhead. With those assumptions, the fixed-cost allowance leaves break-even capacity of850 payments/month. Changing who bears gas or real review prices changes this result; customer agreement and measured costs decide pricing.

Test the hypothesis by showing a real mandate, invoice, settlement and failure record. Ask what the existing process costs in time and money, which purchases truly need autonomous approval, whether minute-scale settlement is acceptable and what budget envelope they would pay for. A claimed reduction in approval time needs a recorded baseline and repeated observed workflow.

## Interview and pilot execution plan

Plan eight interviews with agent-framework builders and crypto research/operations teams, then two fourteen-day pilots. Recruitment and messages require actual user authorization; none has been sent. Suggested distribution is the SDK, MCP/skill integration and developer communities where potential customers already buy agent services. No distribution conversion is measured.

For each interview, record participant role, actual purchase type/frequency, present approval process, loss/incident history, latency tolerance, alternative considered, observed integration friction and the participant's exact price response. Do not substitute an agent's guess for the customer's answer.

For each pilot, agree one real mission, dedicated owner-funded vault, merchant origin, exact budgets, permitted delivery networks and a stop procedure. Retain explicit customer consent, source/release identity, baseline manual approval time, each operation ID, terminal outcome, receipt links and incident/reconciliation notes. Funding and purchases need their own authorization. Mainnet pilots begin only after required release acceptance.

Pilot success criteria to test: repeated authorized purchases on at least three distinct days, complete receipt reconciliation, no duplicate payment, no permission violation and an explicit decision about continuing at the quoted price. Record completion and failures honestly. Recurring use requires actual temporal usage; willingness to pay requires an explicit customer response, paid invoice or commitment. No such evidence currently exists.

## Evidence capture template

| Field | Value to capture when a real participant exists |
|---|---|
| Participant and role | Actual contact/consent record retained privately |
| Interview date and problem | Actual date and current purchase workflow |
| Baseline and observed time | Measured durations and sample sizes |
| Pilot identity | Verified release, environment and dedicated card ID |
| Repeated use | Dated operation IDs across distinct days |
| Outcomes | Terminal states and independently verified receipts |
| Pricing response | Exact customer statement or paid/committed amount |
| Retention decision | Continue/stop and stated reason |

Machine-readable measurements, sources, assumptions and unstarted-study status ship in [integration.json](../packages/sdk/integration.json). The product verifier independently recomputes every latency and illustrative economic figure. It certifies preparation materials only. Mainnet release, hosted first-use, customer validation and the recorded video remain external evidence requirements.
