import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const repository = "TS-mfon/intentguard";
assert.ok(process.argv.slice(2).every(arg => arg === "--hosted"), "Unknown verification option.");
const hosted = process.argv.includes("--hosted");
const workflow = hosted ? "verify-hosted.yml" : "validate.yml";
const command = (name, args) => execFileSync(name, args, {encoding: "utf8", maxBuffer: 4 * 1024 * 1024});
const api = path => JSON.parse(command("gh", ["api", path]));
const head = command("git", ["rev-parse", "HEAD"]).trim();
const runs = api("repos/" + repository + "/actions/workflows/" + workflow + "/runs?head_sha=" + head + "&per_page=20").workflow_runs;
const run = runs.filter(item => item.head_sha === head && item.event === (hosted ? "workflow_dispatch" : "push")).sort((a, b) => b.id - a.id)[0];
assert.ok(run, "No validation run exists for the current source commit.");
assert.equal(run.status, "completed", "The current validation worker is still running.");
assert.equal(run.conclusion, "success", "The current validation worker did not pass.");
const jobs = api("repos/" + repository + "/actions/runs/" + run.id + "/jobs?per_page=100").jobs;
const story = jobs.flatMap(job => job.steps || []).find(step => step.name === (hosted ? "Verify hosted story, media and recovery" : "Verify story playback, audio controls and scroll progression"));
assert.equal(story?.conclusion, "success", "The complete story suite must pass.");
await mkdir(".local/actions-story", {recursive: true});
const directory = await mkdtemp(resolve(".local/actions-story/run-" + run.id + "-"));
command("gh", ["run", "download", String(run.id), "--repo", repository, "--name", hosted ? "hosted-story-browser-evidence" : "story-browser-evidence", "--dir", directory]);
const report = JSON.parse(await readFile(resolve(directory, "browser-report.json"), "utf8"));
assert.equal(report.mode, hosted ? "HOSTED_REAL_WEBGL_AND_MEDIA" : "PRODUCTION_REAL_WEBGL_AND_MEDIA", "A complete report for this verification mode is required.");
if (hosted) assert.equal(report.base, "https://intentguard-tapeout.vercel.app");
else assert.match(report.base, /^http:\/\/127\\.0\\.0\\.1:\\d+$/);
assert.deepEqual(report.pageErrors, []);
assert.deepEqual(report.viewports, [320, 390, 768, 1440, 1920]);
assert.ok(report.media.bytes > 100000 && report.media.bytes <= 8 * 1024 * 1024);
assert.ok(report.media.duration >= 24 && report.media.duration <= 32);
const expected = [
  "public server-rendered narrative and actual MP4/JPEG delivery",
  "native keyboard PageDown and wheel scroll advance the story",
  "actual WebGL frames, physical material pixels and pointer/idle motion",
  "keyboard pause/resume freezes actual rendered pixels and frame loop",
  "six distinct rendered poses, truthful skipped review/no transfer branch and original scroll cues",
  "real hidden/offscreen suspension of AudioContext and renderer; native offscreen fixture uses test-only continuation spacer",
  "opt-in film, actual playback/ending/replay, keyboard, mute/volume, transcript, tab suspension and sound handoff",
  "all six chapters have no overflow at 320/390/768/1440/1920",
  "fresh portrait hero uses the actual initial camera pose at 390x844",
  "reduced motion gives static rendered pose, no film autoplay and deliberate playback",
  "real media network failure displays poster/transcript and retry recovers actual video",
  "WebGL unavailable and actual context loss preserve story/poster; retries render again",
  "route navigation closes actual AudioContext"
];
assert.deepEqual([...report.checks].sort(), [...expected].sort(), "Every required check must be present, including all recovery and disposal cases.");
const poses = report.visual.filter(item => item.kind === "pose");
assert.equal(poses.length, 5);
assert.equal(new Set(poses.map(item => item.hash)).size, 5);
assert.ok(poses.every(item => item.ratio > .035 && item.mean > 1));
assert.ok(report.visual.some(item => item.kind === "pointer" && item.ratio > .001));
assert.ok(report.visual.some(item => item.kind === "blocked-transfer" && item.ratio > .001));
await writeFile(hosted ? ".local/hosted-story-actions-verification.json" : ".local/story-actions-verification.json", JSON.stringify({head, runId: run.id, runUrl: run.html_url, artifactDirectory: directory, report}, null, 2) + "\n");
console.log("STORY_ACTIONS_VERIFIED", JSON.stringify({head, runId: run.id, checks: report.checks.length}));
