import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
assert.equal(Number(process.versions.node.split(".")[0]), 24, "Node 24 is the reviewed toolchain");
const source = "contracts/genlayer/versions/purchase_reviewer_v4.py";
const published = JSON.parse(readFileSync(new URL("../../contracts/genlayer/versions/purchase_reviewer_v4.schema.json", import.meta.url), "utf8"));
const oldSources = {
  "contracts/genlayer/purchase_reviewer.py": "2dc4d00d2a12ff43bb5cc58228a99b326bbe22841d3f43a084a8f56d6508a2d4",
  "contracts/genlayer/versions/purchase_reviewer_v1.py": "0ec8749a19725514590989989645671f8211c346d78e68e3c9bf18866a3585b4",
  "contracts/genlayer/versions/purchase_reviewer_v3.py": "8259d6147bb7ee1d8c13b6fa845739672a27080f028735068aa5bc53f72aca96",
  "contracts/genlayer/permission_interpreter.py": "9621ce5044401a583a0b8400110fb6d34e4929851a52343de1f38c2983abf8e9",
};
for (const [path, hash] of Object.entries(oldSources)) {
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../" + path, import.meta.url))).digest("hex"), hash, "Legacy source changed: " + path);
}

function run(args, label) {
  const result = spawnSync("uvx", ["--offline", "--from", ...args], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write((result.stderr ?? "") + (result.stdout ?? ""));
    throw new Error(label + " failed", { cause: result.error });
  }
  return result.stdout;
}

function requireSchema(value) {
  assert.deepStrictEqual(value, published, "V4 extracted ABI differs from the published schema");
}
const extracted = JSON.parse(run(["genvm-linter==0.11.0", "genvm-lint", "schema", source, "--json"], "Schema extraction"));
assert.equal(extracted.ok, true);
requireSchema(extracted.schema);
// A known positive control and two deliberate ABI mutations establish that the
// schema check fails for constructor drift and a wrong getter return type.
const changedConstructor = structuredClone(extracted.schema);
changedConstructor.ctor.params.pop();
assert.throws(() => requireSchema(changedConstructor));
const changedGetter = structuredClone(extracted.schema);
changedGetter.methods.get_settlement_profile_hash.ret = "int";
assert.throws(() => requireSchema(changedGetter));

const lint = run(["genvm-linter==0.11.0", "genvm-lint", "check", source, "--json"], "V4 contract lint/validation");
const lintResult = JSON.parse(lint);
assert.equal(lintResult.ok, true, "V4 lint/validation did not succeed");

const interpreterSource="contracts/genlayer/versions/permission_interpreter_v2.py";
const interpreterSchema=JSON.parse(readFileSync(new URL("../../contracts/genlayer/versions/permission_interpreter_v2.schema.json",import.meta.url),"utf8"));
const interpreterExtracted=JSON.parse(run(["genvm-linter==0.11.0","genvm-lint","schema",interpreterSource,"--json"],"V2 interpreter schema"));
assert.equal(interpreterExtracted.ok,true);assert.deepStrictEqual(interpreterExtracted.schema,interpreterSchema);
const interpreterLint=JSON.parse(run(["genvm-linter==0.11.0","genvm-lint","check",interpreterSource,"--json"],"V2 interpreter lint"));assert.equal(interpreterLint.ok,true);

// Includes legacy behavior, real SDK pickling and explicitly captured validators.
// Web/model fixtures are controls, not a live-consensus or deployment claim.
const testOutput = run(["genlayer-test==0.29.2", "gltest", "contracts/genlayer/tests/direct", "-q"], "Legacy and V4 direct tests");
const summary = testOutput.match(/(?:^|\n)(\d+) passed(?:, (\d+) skipped)? in [\d.]+s(?:\n|$)/);
assert.ok(summary, "Missing decisive pytest success summary");
assert.equal(summary[2], undefined, "Required tests must not be skipped");
console.log("Reviewer SDK tests: " + summary[1] + " passed; legacy source hashes and V4 ABI verified.");
console.log("Scope: direct SDK fixtures; live finality, semantic reliability and network deployment remain release gates.");
console.log("REVIEWER_VERIFIED");
