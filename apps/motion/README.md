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
