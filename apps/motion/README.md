# IntentGuard agent ATM film

Original, deterministic, silent graphite-agent and engraved-card loop for the IntentGuard landing page. It contains protocol branding only; no user identity, balances, requests or transactions are invented.

The isolated Remotion 4.0.538 package is a build tool and is not part of the hosted application dependencies. Licensed IBM Plex Sans and Mono fonts are served locally while rendering. All animation is derived from the frame number and a periodic phase; no runtime CSS animation, wall clock, remote asset or random data is used.

## Reproduce

Use Node 22+ and npm. From this directory:

```sh
npm ci --ignore-scripts
npm run lint
npm run render
npm run poster
```

Outputs: `../web/public/motion/agent-card.mp4` and `agent-card-poster.jpg`. The source composition is 1280×720, 30fps, 300 frames / 10 seconds. Render H.264 with yuv420p for browser support, no audio, CRF 22 and fast-start.

The isolated package overrides transitive Zod to 4.6.6 to include the constrained-collection memory fix. Remotion 4.0.538 currently declares 4.5.4 and emits a version advisory; this composition uses no Zod schemas. Lint, full rendering, decode and loop checks pass with the pinned override; npm audit reports no vulnerabilities.

The hosted UI provides a poster, pause control, reduced-motion behavior and offscreen/tab suspension. Do not infer product status or live activity from this decorative film.

Run `node ../../scripts/verify-motion.mjs` for independent metadata, payload and full decode validation.

Font license: `public/fonts/OFL.txt`.

## Protocol story with synchronized original sound

The independent `ProtocolStory` composition powers `/why-we-exist`; it preserves the silent `AgentCard` composition and outputs. This is an illustrated protocol journey, not recorded user activity.

```sh
npm run story:render
npm run story:poster
node ../../scripts/verify-story-motion.mjs
```

Render: 1920×1080, 30fps, 840 frames / 28s, H.264 yuv420p, stereo AAC 128kbps, CRF25 and fast-start. Outputs are `protocol-story.mp4` and `protocol-story-poster.jpg` in the website media directory. Audio codec padding may report approximately 28.011s.

The seven shots show human-mandate assembly, the agent physically presenting its engraved ATM card to a reader, an over-limit TapeOut branch with GenLayer review skipped and no transfer, permitted reservation, committed evidence with independent findings, X Layer permission recheck and transfer, and the merchant receipt. Depicted validator nodes represent independent findings, not a fixed network validator count.

| Start | Shot | Synchronized sound |
|---|---|---|
| 0s | Intent assembly | Mechanism and original harmonic score |
| 4.667s | Card presentation/tap | Swipe at 3.5s, scan at 6.2s |
| 8.333s | Over-limit block | Denial at 10.3s |
| 12s | Within-limit reservation | Gate mechanism at 13.5s |
| 15.667s | Evidence/validation | Scan at 17.8s, findings at 18.4/19/19.6s, seal at 20.2s |
| 20.333s | Recheck/settlement | Mechanism/transfer at 23s |
| 24s | Receipt | Confirmation at 25.2s, clean score fade |

`scripts/generate-story-sound.mjs` is the original procedural sound source. It creates a deterministic 48kHz stereo PCM soundscape from sine harmonics, a fixed-seed filtered-noise generator, and explicitly timed swipe/scan/denial/mechanism/compute/seal/confirmation events. No external samples, voice, music or licenses are required. The WAV is generated before rendering and omitted from Git; the small event/mix manifest remains available in `public/protocol-story-sound-events.json`. Importing the generator exposes an in-memory reference without writing files, enabling encoded soundtrack alignment tests.

Verification fully decodes video and audio, requires visible movement in every scene, checks frame/codec/payload metadata, validates stereo, moderate RMS/peak and clean fades, verifies all audible event windows and correlates encoded audio with the source to catch synchronization errors. Every amount/identity/status in this film is conceptual protocol illustration; use the explorer for actual usage.

Frame review contact sheet, generated locally after render:
`out/story-review-frames.jpg`.
