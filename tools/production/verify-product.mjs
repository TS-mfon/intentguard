import assert from "node:assert/strict";
import {readFile, mkdir, writeFile, cp, mkdtemp, rm} from "node:fs/promises";
import {resolve, join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";

const root = resolve(import.meta.dirname, "../.."), folder = join(root, ".local/product");
assert.equal(process.version, "v24.18.0", "Use the reviewed Node24.18.0 toolchain.");
const environment = {PATH: process.env.PATH, ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {})};
const checks = [];
function run(command, args, marker, tests = false) {
  const result = spawnSync(command, args, {cwd: root, env: environment, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024});
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  if (result.error || result.status !== 0) { process.stderr.write(output.slice(-24000)); throw result.error ?? Error("Product check failed: " + command + " " + args.join(" ")); }
  if (marker) assert.ok(output.includes(marker), "Missing decisive success marker " + marker);
  let count;
  if (tests) {
    for (const field of ["fail", "cancelled", "skipped", "todo"]) assert.match(output, new RegExp("^# " + field + " 0$", "m"), "Every product regression must execute");
    count = Number(output.match(/^# tests (\d+)$/m)?.[1]); assert.ok(count > 0 && Number(output.match(/^# pass (\d+)$/m)?.[1]) === count);
  }
  checks.push({command: command === process.execPath ? "node" : command, args, ...(count === undefined ? {} : {tests: count}), transcriptSha256: createHash("sha256").update(output).digest("hex")});
  console.log("PRODUCT_CHECK " + args.at(-1) + (count ? " tests=" + count : ""));
}
run(process.execPath, ["packages/mcp/scripts/update-schema.mjs", "--check"], "OPENAPI_CURRENT");
run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-protocol-docs.ts"], "Protocol documentation verification passed");
run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "--test-reporter=tap", "tests/sdk-profile.test.ts"], undefined, true);
run(process.execPath, ["--test", "--test-reporter=tap", "packages/mcp/test/server.test.mjs"], undefined, true);
run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--lib", "es2023,dom", "packages/sdk/index.ts"]);
// A vendored runtime imports with no checkout, server, wallet, database or dependencies.
const temporary = await mkdtemp(join(tmpdir(), "intentguard-product-"));
try {
  await cp(join(root, "packages/sdk"), join(temporary, "sdk"), {recursive: true});
  const smoke = `import assert from "node:assert/strict"; import {ProtocolClient, OwnerClient, commitment, validatePayment} from "./sdk/client.mjs"; const c=new ProtocolClient({baseUrl:"https://explicit.example",paymentEnvironment:"testnet",fetchImpl:async()=>Response.json({agents:[],nextCursor:null})}); assert.deepEqual(await c.listAgents(),{agents:[],nextCursor:null}); assert.ok(new OwnerClient({baseUrl:"https://explicit.example",paymentEnvironment:"testnet"})); assert.equal((await commitment({a:1})).length,66); assert.throws(()=>validatePayment({amount:"0"})); console.log("VENDORED_SDK_VERIFIED");`;
  await writeFile(join(temporary, "smoke.mjs"), smoke);
  run(process.execPath, [join(temporary, "smoke.mjs")], "VENDORED_SDK_VERIFIED");
} finally { await rm(temporary, {recursive: true, force: true}); }
const guide = JSON.parse(await readFile(join(root, "packages/sdk/integration.json"), "utf8"));
const report = {version: 1, status: "PRODUCT_VERIFIED", scope: "SDK_MCP_OPENAPI_PROTOCOL_SKILL_AND_COMMERCIAL_DEMO_PREPARATION", protocolVersion: guide.protocolVersion, verifiedAt: new Date().toISOString(), checks, liveMainnetAcceptance: false, customerValidation: false, submissionVideoRecorded: false};
await mkdir(folder, {recursive: true}); await writeFile(join(folder, "verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({protocolVersion: guide.protocolVersion, sdkTests: checks.find(c => c.args.includes("tests/sdk-profile.test.ts")).tests, mcpStdioTests: checks.find(c => c.args.includes("packages/mcp/test/server.test.mjs")).tests, checks: checks.length, liveMainnetAcceptance: false, customerValidation: false, submissionVideoRecorded: false}));
console.log("PRODUCT_VERIFIED");
