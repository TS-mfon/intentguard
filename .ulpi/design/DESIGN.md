---
project: IntentGuard
register: product
aesthetic_direction: industrial / signage
color_strategy: restrained
design_system: Radix primitives + locked CSS tokens
design_variance: 8
motion_intensity: 6
visual_density: 5
---
## Design Read
Issued identity. A precision spending instrument with a memorable mechanical agent and engraved ATM card.
## Signature
The split-slot monogram combines a card's chip contacts with a permission gate: two offset vertical rails with a crossbar and an open passage. No shield or generic hexagon logo.
An ATM card is the actual domain object. The physical card vocabulary carries identity and measured usage, not decorative dashboard nesting. Agent character: a small graphite terminal with two warm silver eyes and a slot holding its issued card.
## Inspiration
https://chog-evolution.vercel.app/: inspected in Playwright on 2026-10-25 (1440×1000 screenshot /tmp/intentguard-reference.png).
Took oversized wordmark, character foreground, editorial story rhythm, and purposeful entry motion. Rejected purple palette, collectible/game language, circular stickers, numbered eyebrows, and repeated columns.
Synthesis: industrial ATM issuance rather than a reskinned mascot collectible site. The hero is a typographic cover with the card-and-agent motion below/behind the display, not a two-column text/image template.
## Locked tokens
| Role | Hex | OKLCH approx | Usage |
|---|---|---|---|
| background | #101716 | .197 .012 168 | graphite field |
| surface | #192321 | .247 .015 170 | equipment surfaces |
| elevated | #26332f | .307 .020 168 | controls |
| text | #edf2ec | .954 .009 140 | primary |
| muted | #b2beb5 | .791 .018 150 | secondary readable text |
| subtle | #98a89c | .716 .025 151 | captions |
| border | #526359 | .481 .029 154 | visible UI dividers |
| accent | #b5d7ae | .845 .068 139 | stamped permission green |
| success | #b5d7ae | .845 .068 139 | approved |
| warning | #eed09a | .867 .076 82 | evidence/action needed |
| danger | #f4a8a3 | .807 .092 24 | rejected/error |
| info | #b5cbd4 | .827 .030 226 | pending/available |
Text on background 15.8:1; muted 9.3:1; subtle 7.2:1; dark button text on accent 11.6:1; border on background ≥3:1. All secondary text uses these roles, never opacity for text.
Surface treatments: brushed linear engraving and ruled outlines; no purple glow, gradient text, generic glassmorphism, or green-on-black tech neon.
## Type
Display IBM Plex Sans Condensed (install local @fontsource if needed), 600, compressed industrial signage. Body IBM Plex Sans 400/500. Utility IBM Plex Mono. Contrast is condensed signage versus humanist reading and exact mono amounts. Display tracking floor -0.02em. Body measure max 72ch.
Brand display 72–160px responsive; product h1 40–64px; h2 24–40px; body 16px line-height 1.6; labels 12–14px.
## Scales
Spacing 0,2,4,8,12,16,20,24,32,40,48,64,80,96,128 px.
Radius 4,8,12,16,9999; ATM card 16, buttons 8. No arbitrary pills except identity tags.
Breakpoints 640,768,1024,1280,1536. Content max 1280px; reading max 72ch.
Motion fast 150ms, base 300ms, emphasis 500ms; cubic-bezier(.16,1,.3,1). Page entry stagger 60ms. Scroll reveal once, opacity/translate ≤32px. ATM tilt responds lightly to pointer and scroll. Never animate ledger values, controls, or financial states speculatively.
With reduced motion: no autoplay, no transforms or shimmer, visible poster and static content. Video pauses offscreen. Offer persistent pause control for looping hero. Hero media <=5MB, poster <=300KB.
Focus 2px accent offset 4px. Touch controls at least 48px. Semantic buttons/links, Radix modal/tab behavior, keyboard navigation retained.
## Voice
Plain, specific, technical. Create agent → agent created. Download card, Share on X, Review skipped, Review failed, Needs evidence, Paid. No sample identities, sample financial data, or unverified performance claims. TEST-USDT always labeled testnet with no monetary value.

## Cinematic story variation (2026-10-25 user amendment)
Only /why-we-exist uses the immersive luxury/refined presentation specified in why-we-exist-cinematic.md: authored full viewport 3D agent/card, studio shading, native scroll camera choreography and large sparse typography. Existing product screens retain this industrial/signage identity. Same mark, palette, fonts and accessible controls; motion intensity 9 for the story, static with reduced motion. Cinematic pose/camera movement overrides the original small-scroll-reveal limit only inside this route. Active Theory/Cuberto/Lusion references are recorded with actual intake evidence in the per-feature spec; no proprietary assets are copied.

## Glossy agent identity variation (2026-10-30 user amendment)

The user explicitly requests a glossy, transparent, premium shareable agent card. This authorizes a **luxury / refined smoked-glass material on the issued card and its SVG/PNG exports**, specified in glossy-agent-card.md. It deliberately overrides the earlier glass ban for this one physical instrument. Other product surfaces retain their industrial/signage treatment.

Signature: the split-slot mark appears as a large, faint engraving beneath the smoked face, framed by a polished double rim and one broad diagonal studio reflection. Preserve graphite, sage, ivory and IBM Plex typography. No rainbow foil, purple glow, metallic gradient text, decorative status dots, luxury tiers or invented credentials. The actual agent name and settled usage remain the focal point.

Scoped material tokens supplement the existing roles:

| Role | Hex / treatment | Usage |
|---|---|---|
| glass body | #192321 at .84–.94 alpha | Translucent smoked face; alpha is retained in exports |
| glass shadow | #101716 | Undertone and content-area tint |
| glass secondary | #c7d0c9, OKLCH approximately .84 .013 148 | Legible secondary engraving on translucent material |
| polished edge | #edf2ec at .18–.75 alpha | Fine top/left rim, a dimmer bottom/right rim |
| glass reflection | #edf2ec at 0–.12 alpha | One broad studio-light sweep, strongest away from text |
| glass etching | #b5d7ae at .04–.12 alpha | Large split-slot engraving; purely decorative |
| chip | #c7d0c9 / #98a89c / #526359 | Existing chip geometry rendered as brushed silver |

Content zones must remain no brighter than #41504a after all layers are composed, including over a white surface. Measured contrast at that limit: ivory7.49:1; glass secondary5.38:1; sage5.38:1. Existing muted #b2beb5 reaches only4.42:1 there, so it is not the card's secondary text color. These constraints apply to export art as well as CSS.

Use the existing radius and spacing scales. The1200×760 export has32px outer radius (the16px instrument radius at2×). Live card radius16px, measured aspect1200/760, padding24–32px desktop and20px on small mobile. Motion uses existing restrained CardTilt; no looping shimmer. Reduced motion is static. Export art uses SVG paths, gradients and embedded local fonts where needed, without external resource requests or raster assets.
