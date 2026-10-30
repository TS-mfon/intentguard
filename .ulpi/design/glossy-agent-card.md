# Glossy shareable agent card

Every screen must read as the same product if placed side by side.

Design Read: a smoked crystal spending instrument, polished enough to feel collectible and precise enough to carry real financial evidence.

Direction: **luxury / refined**, applied only to the existing agent identity card. It inherits the locked graphite/sage identity, split-slot mark, IBM Plex Sans Condensed display, IBM Plex Sans body and IBM Plex Mono figures. The user supplied no references. This is an authored material treatment of IntentGuard's actual card, not a generic translucent dashboard or a bank-card clone.

## Composition and material

The current striped metal surface is visually flat. Replace its repeated engraving with real translucent smoke, thin specular edges, one broad diagonal reflection and a large ghosted split-slot watermark. The card must look like a physical sheet of tinted glass. Preserve actual alpha in both SVG and PNG, including transparent rounded corners. It must also look deliberate when composited over a light background, without unreadable text.

The live card may sit on a restrained presentation stage with a faint static impression of the same mark behind it, giving the transparent face something to reveal. This stage is part of this single instrument; do not introduce another panel around all the surrounding metadata. Export just the card silhouette, not the page stage.

Use three material layers: a translucent graphite body, the subtle engraved mark behind content, and a masked diagonal light band. The dominant bright reflection stays in the upper/right vacant area. Fine double-rim geometry catches the top/left light. Inner edge is quiet, lower/right edge is darker. No scanline texture, neon bloom, all-over sparkle or constantly moving sheen. Chip retains recognizable contact geometry but gains a silver finish.

Card hierarchy:

1. Brand row: split-slot monogram + IntentGuard left; small AGENT CARD designation and actual payment network right.
2. Issued identity: small ISSUED TO label, the real agent name as the largest text block, short mission line where space permits. Chip anchors the left, deterministic existing agent terminal glyph sits to the right as a subtle seal.
3. Usage strip: FUNDS MOVED as the dominant figure, REQUESTS MADE as the secondary figure. A small PAID / BLOCKED pair is allowed in the roomy export, using actual counts. Avoid treating each figure as a nested card.
4. Bottom engraving: abbreviated actual vault address and policy commitment, textual actual status. A discreet bottom disclosure identifies testnet1952 with no monetary value, or mainnet196 with Studionet testnet review; snapshot time stays truthful. Use the configured application hostname for the exported provenance where practical. Do not label mainnet exports as testnet.

Keep existing .atm-card, .atm-usage, .issued-identity hooks and the CardDownload API contract. The preview and exported art must share this material, color palette, chip, title hierarchy and aligned composition. Different rendering technologies must not produce two unrelated cards.

## Data and export contract

CardDownload continues to accept id and compact. Use the existing public agent/card resource. No request to create a new agent, payment or credential is introduced.

All metrics remain from the current usage aggregation. Preserve exact decimal fundsMoved in exports and existing truthful formatting in the preview; no abbreviating into invented rounded spending. Counts are cumulative admitted records and funds moved is settled only. Retain address, policy commitment and snapshot in the exported art. Status is actual server-derived state, never a decorative VERIFIED/PREMIUM badge.

SVG remains a standalone1200×760 attachment. It must use no external font/image references, browser-only foreignObject or script. Embedded immutable local fonts are acceptable; untrusted name, mission, status, address, symbol and provenance are escaped. SVG and canvas-exported PNG must look like the same card. PNG keeps alpha; never fill the canvas with an opaque rectangle. Use the current blob download, object URL cleanup, timeout and actionable error path.

Support short names, long names up to the actual policy limit, unicode, long exact amounts, six-digit counts, zero usage, paused/revoked/unavailable status and both environments. Keep overflow away from chip, status and neighboring numeric columns. Prefer sensible line breaks and bounded font sizing; expose full names in accessible text/title even if the visual art truncates.

## Flows and states

Owner overview or public agent explorer -> actual card loads -> user inspects identity/usage -> Download card/SVG, PNG or Share on X. Existing X composition links the public record and explains manual image attachment. Downloads do not post to a social account.

Loading: same silhouette with static loading treatment; aria-busy and existing status message. Error/404: current actionable notice and Retry card, no fabricated card. Empty legitimate usage: zero counts and settled amount, no sample purchase. Offline/export failure: retain visible actual card and explain retry or SVG fallback. Refresh: reload actual snapshot through existing resource hook. No wallet/session is required for the public card. Owner auth and other flows are not redesigned.

Buttons retain current primitives, keyboard tab order, visible focus and48px targets. Snapshot and all figures are readable DOM text; decoration is aria-hidden and pointer-events:none. SVG has descriptive title/desc. Never announce sheen changes. Mouse-only existing tilt is the one motivated motion: it lets the material catch light as the user inspects it. Touch and reduced-motion users get the full static appearance.

## Responsive behavior

Full preview is fluid to available width; no page overflow at320,390,768,1440px. Compact/public explorer cards keep their important name, primary amount, request count and actual status. On small cards stack network designation and allow name wrapping; scale only typography and spacing, never hide the payment environment or introduce unreadable tiny figures. Mobile can grow in height rather than overlap. The exported1200×760 composition stays fixed and readable at social-preview width600px.

## Design preflight

- Identity read first; this explicit user amendment introduces no new accent, icon system or type family.
- Bans retained: no purple/glow, gradient text, fake tiers, decorative status dots, scanlines, generic dashboard glass or invented activity. Translucent instrument is expressly requested and justified.
- Material is the signature; real name and settled funds are the focal point. Existing card, ruled metadata and external action row provide the three relevant layout families without expanding the page.
- All loading/error/empty/success/export/offline/refresh states specified. Button semantics and keyboard flow retained.
- Contrast is measured against the brightest permitted composed content background: primary7.49, secondary5.38, accent5.38. A lighter secondary token replaces the insufficient4.42 muted pairing.
-48px touch targets; reduced motion static; all decorative layers excluded from accessibility tree. Three familiar export/share choices remain visible.
- Critique scores: distinctiveness3, hierarchy3, consistency4, accessibility3, state coverage4, copy3, restraint3, motivated motion3 =26/32. These are design-spec judgments; runtime/screenshots must still validate implementation.
- Revisions before handoff: constrain the reflection away from text for contrast; preserve true export alpha for a genuine translucent artifact; require payment-environment disclosure to remain correct.

## Engineering handoff

Target: native engineering agent acting as nextjs-senior-engineer. Design system: existing Radix primitives + locked CSS tokens; no installation or replacement of buttons/dialogs.

Implement exactly this spec. Theme the design system with our locked tokens; do NOT redesign or re-implement its components.

Own apps/web/components/agent-card.tsx, a new scoped agent-card.module.css, apps/web/lib/agent-card.ts and any narrow immutable art/font helper you need in those directories. Preserve .atm-* hooks. Avoid editing globals.css or unrelated brand/motion/media/runtime code. Existing brand glyphs may be styled locally. Root owns this spec, browser acceptance script and final independent visual review. Add no dependency unless essential and discussed with root. Do not commit, push or deploy from the child.

Acceptance: materially glossy/translucent appearance rather than cosmetic border changes; consistent live/SVG/PNG design; correct actual metrics, immutable identity and environment disclosure; successful standalone transparent PNG export; XML safety preserved; mobile/long-content/reduced-motion/keyboard/error checks; typecheck and production build. Existing focused identity API regressions should pass; add a meaningful export regression only if the altered serializer behavior needs one. Return changed files, verification and a clean handoff for root's independent preview and export inspection.
