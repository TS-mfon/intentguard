# Spending cards and ledger
Every screen must read as the same product if placed side by side.
## Layout
Three families: asymmetric spending-card overview, ruled payment ledger, progressive permission wizard. Navigation Cards/Payment ledger/Agent API, plus owner wallet and network. Card is focal point with chip and genuine agent identity; side column contains financial details and two-gate rail. No three equal cards, nested cards, glassmorphism, decorative activity dots, marketing mesh, buzzwords or fabricated metrics.
## Flows
Disconnected: Connect wallet primary; labelled read-only Sample preview secondary. Login challenge/signMessage/cookie. Restore session and records after refresh.
Wizard: Describe mission (name, mission, context, scope); Limits (total/payment/period/duration, expanded dates); Merchants/evidence (repeatable named address/origins/products, approved source list/freshness); Review (GenLayer proposed exact terms, questions or errors). Group at most4 fields, progressive disclosure. POST draft, poll every5s. Regenerate edits, activation only after final successful proposed result.
Activation: factory ABI in contracts/evm/abi.json, exact approved configuration, owner writeContract, await receipt then register POST owner/cards. Fund: ERC20.transfer exact units, await receipt. No synthetic success when unavailable.
Keys: one-time Radix dialog; explicit Copy; no persistent browser storage; rotate/revoke owner API.
Ledger: semantic table merchant/purchase, card/agent, amount, state,time; filters; request detail budget decision, criteria/reasons/sources, evidence digests, actual protocol transaction links. Mobile labelled row layout.
Controls: owner-signed pause/revoke/cancel/withdraw. Confirm irreversible revoke. Sample and unavailable writes disabled with explanatory text. Wallet rejection retains form.
## Component contracts
SpendingCard(CardView,selected,onSelect): graphite ATM silhouette, white available funds/name, chip SVG, deterministic agent badge, address copy action, expiry, permitted budget summaries.
LedgerTable(RequestView[],loading,error): sortable/filterable semantic table; empty CTA; retries; scroll/stack at mobile.
PolicyWizard: actual server proposals, editable description/guidance, no silent broadening of permissions; all terms visible before wallet transaction.
RequestDetail: polite live status; pass/fail/insufficient labels/icons; source origins, exact amounts, hashes and actions. No API credentials in records.
## Accessibility and edges
Radix Dialog/Tabs established primitives, keyboard focus visible. Initial dialog focus first field, Escape close/restore trigger. Fields labelled with associated errors; aria-busy loading, role alert errors, aria-live status. Min48px targets, reduced motion. Offline banner, preserved form, refresh restores draft ID only; API keys never persisted. 390/768/1440 viewport tests.
## Preflight and handoff
One palette/fonts/radius/icons; zero banned defaults; three layout families; complete states and contrast checks. Critique3/3/4/3/3/3/3/3=25/32. Revision: real spending-card silhouette and two-gate rail express permission ownership rather than generic feature boxes.
Target native ui agent, nextjs-senior-engineer. Implement exactly this spec. Theme Radix primitives with locked tokens; do NOT redesign or re-implement its components. Typecheck/build and actual browser flows must pass.
