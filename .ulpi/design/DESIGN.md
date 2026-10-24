---
project: IntentGuard
register: product
aesthetic_direction: industrial / signage
color_strategy: restrained
design_system: Radix primitives
design_variance: 7
motion_intensity: 2
visual_density: 6
---
# Locked design language
## Design Read
An agent spending permit with the legibility of a payment terminal and bank ledger.
## Signature
A graphite ATM card with a circuit chip, hash-derived agent badge and a two-gate permission rail. Budget and Evidence slots represent actual states. Steel white background, asymmetric overview, ruled payment ledger. The owner requested payment-ledger, agent and ATM-card design; no reference URLs.
Counterfactual: chip, permissions and identity belong to agent expenditure, not a generic SaaS dashboard.
## Color
Use hex tokens and matching OKLCH generated from sRGB. 60% steel/white, 30% graphite, 10% cobalt maximum. No gradients or glow.
background #eaf0f3; surface #ffffff; elevated #f5f8fa; text #172a34; muted #526471; subtle #637785; border #becbd2; accent #2049c7; success #176644; warning #80530a; danger #ad2c31; info accent.
Measured contrast and OKLCH below use the standard sRGB transfer function and OKLab matrices. Graphite card text is white. Meaningful controls use dark/accent borders with >=3:1; structural border not used for standalone controls.
## Type
IBM Plex Sans 400/500/600 body and display, IBM Plex Mono balances/addresses; locally bundled @fontsource assets. Industrial engineering lineage. Display36/44, title24/32, body14/22, utility12/18; mobile display28/36. Tabular numbers.
## Scales
Spacing0,2,4,8,12,16,20,24,32,40,48,64,80. Radius4,8,12,16. Controls min48px. Card16px radius and 1.586 aspect ratio. lucide-react icons plus specific SVG chip/avatar. Maxwidth1600, navigation rail232, padding32/16. Motion100/300/500ms cubic-bezier(.16,1,.3,1); reduced motion disabled. Navigation20/dialog50/toast70.
## Voice
Create card, Propose terms, Activate card, Fund card, View evidence, Copy API key, Pause card, Revoke key, Cancel request. Plain labels. Pending never represented as paid. Unavailable balances never zero. Demonstration data labelled Sample preview.
## Identity
Every screen must read as the same product if placed side by side.

| Token | sRGB | OKLCH | Contrast on white |
|---|---|---|---|
| background | #eaf0f3 | oklch(95.146% 0.00759 228.855) | 1.15:1 |
| surface | #ffffff | oklch(100.000% 0.00000 89.876) | 1.00:1 |
| elevated | #f5f8fa | oklch(97.742% 0.00417 236.496) | 1.07:1 |
| text | #172a34 | oklch(27.348% 0.03100 232.474) | 14.82:1 |
| muted | #526471 | oklch(49.318% 0.03023 239.615) | 6.14:1 |
| subtle | #637785 | oklch(55.817% 0.03212 238.690) | 4.66:1 |
| border | #becbd2 | oklch(83.426% 0.01728 230.954) | 1.66:1 |
| accent | #2049c7 | oklch(46.419% 0.20088 265.114) | 7.40:1 |
| success | #176644 | oklch(45.459% 0.09318 159.856) | 6.95:1 |
| warning | #80530a | oklch(48.099% 0.09919 71.692) | 6.65:1 |
| danger | #ad2c31 | oklch(49.789% 0.16527 23.678) | 6.60:1 |

Design preflight: owner-led card/ledger signature implemented; no decorative gradients; one type pairing; responsive 390/768/1440 layouts; keyboard dialogs and focus restoration tested; sample/pending/paid states remain distinguishable. CSS has matching OKLCH and sRGB token values.
