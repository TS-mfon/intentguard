# Deployment manifest parsing

`packages/shared/strict-json.ts` rejects duplicate object keys before JSON parsing can discard conflicting evidence. Key comparison decodes escapes and recurses through arrays and nested objects; repeated names in separate objects remain valid. Input is limited to1MiB and64 nesting levels.

The regression suite includes an ordinary nested positive control, conflicting processor/token keys, an escaped duplicate, malformed syntax and depth exhaustion. All3 tests passed with `pnpm exec tsx --test tests/strict-json.test.ts`.

This repairs the parser primitive needed by R05. New mainnet deployment manifests use it before identity/schema validation. Historic evidence is preserved; the original duplicate-key allegation was historical and current baseline JSON did not reproduce it. Final release schema and all published manifests still require release verification.
