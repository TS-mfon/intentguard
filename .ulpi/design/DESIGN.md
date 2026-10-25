---
project: IntentGuard
revision: 2
register: product
aesthetic_direction: luxury / refined
color_strategy: restrained
design_system: Radix primitives
design_variance: 7
motion_intensity: 2
visual_density: 5
---
# Locked design language
## Design Read
A quiet dark spending console where a human mandate stays legible beside every financial decision.
## Revision authority
The user explicitly rejected the previous steel-white ATM dashboard and selected "Dark premium console: charcoal, crisp type, restrained green". This deliberately replaces revision1. No reference URLs supplied.
## Signature
A fine permission edge: a vertical muted-green rule connects mandate, budget gate, evidence review and transfer in transaction details. The same visual logic anchors the landing architecture diagram and agent setup progress. It represents protocol decisions, never decoration or invented status.
Counterfactual: the owner mandate and two independent gates are specific to this product; avoid cryptocurrency price-dashboard tropes, meshes, glowing tokens, ornamental chips, fake balances, or a command-terminal imitation.
Every screen must read as the same product if placed side by side.
## Color
60% charcoal background;30% subtly tinted dark surfaces;10% accent maximum. The selected green is desaturated pale mint, not acid green. The user explicitly requested dark with restrained green. No gradients, glow, glassmorphism or blue-purple accent.
| Role | Hex | OKLCH | Contrast on surface |
|---|---|---|---|
| background | #101414 | oklch(18.69% 0.00625 196.63) | 1.08:1 |
| surface | #171d1b | oklch(22.38% 0.00970 173.26) | 1.00:1 |
| elevated | #202925 | oklch(27.08% 0.01463 166.52) | 1.14:1 |
| text | #f1f5f2 | oklch(96.63% 0.00580 153.78) | 15.54:1 |
| muted | #a4b2aa | oklch(75.03% 0.01927 160.95) | 7.76:1 |
| subtle | #84978b | oklch(65.78% 0.02791 157.84) | 5.52:1 |
| border | #36463e | oklch(37.75% 0.02460 163.30) | 1.71:1 |
| controlBorder | #678073 | oklch(57.61% 0.03510 162.45) | 4.00:1 |
| accent | #80c9a3 | oklch(77.72% 0.09177 160.55) | 8.80:1 |
| warning | #e2b571 | oklch(79.89% 0.10049 76.85) | 9.02:1 |
| danger | #ef8b8b | oklch(74.31% 0.12210 20.39) | 7.11:1 |
Structural dividers use border; functional control boundaries use controlBorder or accent to exceed3:1. Text uses text/muted/subtle at >=4.5:1; status never depends only on color. Primary green controls use background text.
## Type
IBM Plex Sans 400/500/600 for display, body and navigation;IBM Plex Mono for money, addresses and code. Already locally bundled. Humanist sans contrasts with machine-readable mono; preserve crisp engineering character without monospace paragraphs. Display desktop64/68, mobile40/44;page title40/48;section24/32;body16/26;table14/22;utility12/18. Display tracking -0.02em;reading measure72ch. Tabular balances.
## Scales
Spacing0,2,4,8,12,16,20,24,32,40,48,64,80,96,128. Radius4,8,12,16,9999;prefer8 for controls and12 for meaningful panels. One icon family lucide-react, restrained18–20px. Controls minimum48px. Max content1280;content padding desktop48/mobile20;docs reading max800. Navigation max5 items. Sticky header72;workspace sidebar208 optional desktop only.
Motion100/300/500ms cubic-bezier(.16,1,.3,1), only disclosure/focus/page entrance;no infinite animation. Respect prefers-reduced-motion. Layers base0/dropdown20/sticky30/modal50/toast70/skip80.
## Voice
Plain product language. Create agent, Propose policy, Review policy, Activate agent, Fund vault, Issue API key, View transaction, Pause, Revoke, Withdraw. Never imply APPROVED means PAID. Label X Layer Testnet/TEST-USDT from runtime. No demo/sample preview, fabricated names, metrics, transaction rows or fictional quotes. Empty states invite a real action.
## Composition
Landing: editorial cover type, actual chain strip, live ruled transaction list, asymmetric protocol explanation, compact closing action. No repeated three-card feature grid. Workspace: clear data-first heading, real agent list and context panel. Setup: dedicated route with staged form and persistent review summary. Docs: sticky grouped table of contents and readable article. Public explorers: searchable/filterable ruled lists, useful empty/error states, detail deep links.
## Preflight
Spec reviewed:0 default banned fonts;0 prohibited colors (user-selected restrained dark/green exception documented);0 fake names/metrics/data;0 glow/gradient/glass;0 nested-card or repeated three-card pattern;0 decorative numbering. State and keyboard requirements below. All meaningful text/UI pair contrasts measured above. Three landing composition families. One primary action per view. Scores distinctiveness3,hierarchy4,consistency4,accessibility3,states4,copy4,restraint4,motion3(total29/32). Revised prior ATM stamps and blue accents because the user rejected that identity.
