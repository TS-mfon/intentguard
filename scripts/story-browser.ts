import {chromium, type Page, type BrowserContext} from "@playwright/test";
import {spawn, type ChildProcess} from "node:child_process";
import {createServer} from "node:net";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";

const external = process.env.STORY_BASE_URL?.replace(/\/$/, "");
let server: ChildProcess | undefined, output = "", browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let base = external || "";
const folder = new URL("../.local/story-screenshots/", import.meta.url);
await mkdir(folder, {recursive: true});
const consoles: string[] = [];
const errors: string[] = [], checks: string[] = [], visual: unknown[] = [];
const widths = [320, 390, 768, 1440, 1920];
const shortViewports = [{width: 320, height: 568}, {width: 390, height: 844}, {width: 768, height: 700}, {width: 1440, height: 768}, {width: 1920, height: 900}];
const ids = ["the-instruction", "the-mandate", "the-circuit", "the-evidence", "the-transfer", "the-receipt"];
function recordCheck(value: string) {checks.push(value); console.log("STORY_CHECK", value)}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function bounded<T>(promise: Promise<T>, label: string, timeout = 7000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<T>((_, reject) => {timer = setTimeout(() => reject(Error(label + " timed out after " + timeout + "ms")), timeout)})])}
  finally {if (timer) clearTimeout(timer)}
}
async function probeState(page: Page, phase: string) {
  const start = Date.now();
  try {
    const state = await bounded(page.evaluate(() => {
      const journey = document.querySelector<HTMLElement>("[data-story-journey]"), renderer = document.querySelector<HTMLElement>("[data-story-renderer]");
      return {
        scrollY, innerHeight, scrollHeight: document.documentElement.scrollHeight, bodyHeight: document.body.scrollHeight,
        scrollingElement: document.scrollingElement?.tagName, htmlOverflow: getComputedStyle(document.documentElement).overflow,
        bodyOverflow: getComputedStyle(document.body).overflow, mainHeight: document.getElementById("main")?.offsetHeight,
        journeyHeight: journey?.offsetHeight, journey: journey?.dataset, renderer: renderer?.dataset,
        hidden: document.hidden, visibility: document.visibilityState, focus: document.activeElement?.tagName,
        canvas: document.querySelector("canvas")?.getBoundingClientRect().toJSON()
      };
    }), phase);
    console.log("STORY_PROBE", JSON.stringify({phase, elapsedMs: Date.now() - start, state}));
  } catch (error) {console.log("STORY_PROBE", JSON.stringify({phase, elapsedMs: Date.now() - start, error: String(error)}))}
}
async function probePage(page: Page) {
  await probeState(page, "live-before-key");
  await bounded(page.keyboard.press("PageDown"), "live key", 5000).catch(error => console.log(String(error)));
  await delay(500); await probeState(page, "live-after-key");
  await bounded(page.getByRole("button", {name: "Pause scene", exact: true}).click({force: true, timeout: 4000}), "pause control", 5000).catch(error => console.log(String(error)));
  await delay(250); await probeState(page, "paused-before-key");
  await bounded(page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); scrollTo({top: 0, behavior: "instant"})}), "paused reset", 5000).catch(error => console.log(String(error)));
  await bounded(page.keyboard.press("PageDown"), "paused key", 5000).catch(error => console.log(String(error)));
  await delay(500); await probeState(page, "paused-after-key");
  await bounded(page.screenshot({path: new URL("probe-paused.png", folder).pathname, timeout: 5000}), "paused screenshot", 5500).catch(error => console.log(String(error)));
}


async function noOverflow(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "Horizontal overflow at " + await page.evaluate(() => innerWidth));
}
type ControlRect = {x: number; y: number; width: number; height: number};
function controlsIntersect(a: ControlRect, b: ControlRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
// A positive overlap and a separate pair exercise the rectangle oracle itself.
assert.equal(controlsIntersect({x: 0, y: 0, width: 20, height: 20}, {x: 10, y: 10, width: 20, height: 20}), true);
assert.equal(controlsIntersect({x: 0, y: 0, width: 20, height: 20}, {x: 0, y: 28, width: 20, height: 20}), false);
async function heroActionsDistinct(page: Page) {
  const film = page.getByRole("button", {name: "Watch the protocol film", exact: true});
  const invitation = page.getByRole("link", {name: "Scroll to follow the card", exact: true});
  await film.waitFor({state: "visible"}); await invitation.waitFor({state: "visible"});
  const a = await film.boundingBox(), b = await invitation.boundingBox();
  assert.ok(a && b, "Hero actions have actual rendered bounds");
  assert.equal(controlsIntersect(a, b), false, "Film and scroll invitation overlap");
  const viewport = page.viewportSize()!;
  for (const [name, rect] of [["film", a], ["scroll", b]] as const) {
    assert.ok(rect.width > 100 && rect.height >= 44, name + " has readable text and a touch target");
    assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1, name + " is horizontally visible");
    await (name === "film" ? film : invitation).scrollIntoViewIfNeeded();
    const visible = await (name === "film" ? film : invitation).boundingBox();
    assert.ok(visible && visible.y >= 0 && visible.y + visible.height <= viewport.height + 1, name + " is fully reachable in the viewport");
  }
  visual.push({view: "hero-action-layout", viewport, film: a, scroll: b});
}
async function stageAt(page: Page, index: number) {
  await page.evaluate(({id}) => {
    const element = document.getElementById(id), journey = document.querySelector<HTMLElement>("[data-story-journey]");
    if (!element || !journey) throw Error("Missing chapter " + id);
    const header = parseFloat(getComputedStyle(journey).getPropertyValue("--story-header")) || 0;
    scrollTo({top: element.getBoundingClientRect().top + scrollY - header, behavior: "instant"});
  }, {id: ids[index]});
  await page.waitForFunction(index => document.querySelector("[data-story-journey]")?.getAttribute("data-active") === String(index), index);
}
async function rendererReady(page: Page) {
  await page.locator('[data-story-renderer="ready"]').waitFor({timeout: 60000});
  await page.waitForFunction(() => Number(document.querySelector("[data-story-renderer]")?.getAttribute("data-story-frame")) >= 1, undefined, {timeout: 30000});
  assert.equal(await page.locator("[data-story-renderer] canvas").count(), 1, "A real WebGL canvas exists");
}
async function frames(page: Page) {return Number(await page.locator("[data-story-renderer]").getAttribute("data-story-frame"))}
async function audioStates(page: Page) {
  return page.evaluate(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).map(context => context.state));
}
async function trackAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    const Native = window.AudioContext, contexts: AudioContext[] = [], oscillators: OscillatorNode[] = [];
    Object.defineProperty(window, "__storyContexts", {value: contexts});
    Object.defineProperty(window, "__storyOscillators", {value: oscillators});
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {super(options); contexts.push(this)}
      createOscillator() {const oscillator = super.createOscillator(); oscillators.push(oscillator); return oscillator}
    };
  });
}
async function pixelSample(page: Page, screenshot: Buffer) {
  return page.evaluate(async data => {
    const image = new Image();
    image.src = "data:image/png;base64," + data;
    await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 120, 80);
    return Array.from(context.getImageData(0, 0, 120, 80).data);
  }, screenshot.toString("base64"));
}
function difference(a: number[], b: number[]) {
  assert.equal(a.length, b.length);
  let total = 0, changed = 0;
  for (let index = 0; index < a.length; index += 4) {
    const value = Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
    total += value; if (value > 12) changed++;
  }
  return {mean: total / (a.length / 4 * 3), ratio: changed / (a.length / 4)};
}
async function sceneSnapshot(page: Page, name: string) {
  // Exclude all foreground HTML, including the two-pixel progress line.
  assert.equal(await page.locator("[data-story-viewport] > div:last-child").evaluate(element => Math.round(element.getBoundingClientRect().height)), 2, "Scene isolation targets the HTML progress line");
  const style = await page.addStyleTag({content: '[data-story-chapter],[data-story-reading-shade],[aria-label="Scene controls"],[data-story-viewport] > div:last-child{visibility:hidden!important}'});
  try {
    const screenshot = await page.locator("[data-story-renderer] canvas").screenshot({path: new URL(name + ".png", folder).pathname});
    return {pixels: await pixelSample(page, screenshot), hash: createHash("sha256").update(screenshot).digest("hex")};
  } finally {await style.evaluate(element => element.parentNode?.removeChild(element))}
}

async function verifyGpu(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string) {
  const gpuContext = await browser.newContext({viewport: {width: 390, height: 900}, reducedMotion: "reduce"});
  await gpuContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    (window as typeof window & {__failWebGL?: boolean}).__failWebGL = true;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      if (/webgl/.test(type) && (window as typeof window & {__failWebGL?: boolean}).__failWebGL) return null;
      return original.call(this, type as "2d", options as CanvasRenderingContext2DSettings);
    } as typeof original;
  });
  const gpuPage = await gpuContext.newPage(); gpuPage.on("pageerror", error => errors.push(error.message));
  const diagnostic = process.env.STORY_GPU_PROBE === "1";
  if (diagnostic) {
    gpuPage.on("console", message => console.log("GPU_CONSOLE", message.type(), message.text()));
    gpuPage.on("close", () => console.log("GPU_PAGE_CLOSED"));
    browser.on("disconnected", () => console.log("GPU_BROWSER_DISCONNECTED"));
  }
  await gpuPage.goto(base + "/why-we-exist", {waitUntil: "domcontentloaded"});
  await gpuPage.getByRole("alert").filter({hasText: "The 3D scene is unavailable."}).waitFor({timeout: 30000});
  assert.equal(await gpuPage.getByRole("heading", {name: "The amount fits. Does the reason?", level: 2}).count(), 1, "Failure leaves semantic story available");
  assert.equal(await gpuPage.locator("[data-scene-poster] img").evaluate(element => (element as HTMLImageElement).naturalWidth > 0), true);
  await noOverflow(gpuPage); await gpuPage.screenshot({path: new URL("webgl-error-390.png", folder).pathname});
  await gpuPage.evaluate(() => {(window as typeof window & {__failWebGL?: boolean}).__failWebGL = false});
  await gpuPage.getByRole("button", {name: "Retry 3D scene", exact: true}).click();
  if (diagnostic) await probeState(gpuPage, "gpu-retry-before-ready");
  await rendererReady(gpuPage);
  if (diagnostic) await probeState(gpuPage, "gpu-retry-ready");
  const realLoss = await gpuPage.locator("[data-story-renderer] canvas").evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext("webgl2"), extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext(); return true;
  });
  assert.equal(realLoss, true, "Use a real WebGL context loss negative control");
  await gpuPage.getByRole("alert").filter({hasText: "The 3D scene is unavailable."}).waitFor();
  await gpuPage.getByRole("button", {name: "Retry 3D scene", exact: true}).click(); await rendererReady(gpuPage);
  await gpuContext.close();
  recordCheck("WebGL unavailable and actual context loss preserve story/poster; retries render again");
}

try {
 mainChecks: {
  if (!external) {
    await readFile(new URL("../apps/web/.next/BUILD_ID", import.meta.url), "utf8");
    const port = await new Promise<number>(resolve => {
      const socket = createServer();
      socket.listen(0, "127.0.0.1", () => {const address = socket.address(); socket.close(() => resolve(typeof address === "object" && address ? address.port : 3999))});
    });
    base = "http://127.0.0.1:" + port;
    server = spawn("pnpm", ["--filter", "@intentguard/web", "start", "--port", String(port)], {
      cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", env: {...process.env, APP_URL: base}
    });
    server.stdout?.on("data", chunk => output += chunk.toString());
    server.stderr?.on("data", chunk => output += chunk.toString());
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await fetch(base + "/why-we-exist").then(response => response.ok).catch(() => false)) break;
      await delay(500);
    }
  }
  const response = await fetch(base + "/why-we-exist", {signal: AbortSignal.timeout(30000)});
  assert.equal(response.status, 200, "Story route is public");
  const html = await response.text();
  for (const text of ["INTELLIGENCE.", "WITH PERMISSION.", "Your mission.", "TapeOut", "GenLayer", "NetlistVM"]) assert.ok(html.includes(text), "Server-rendered story: " + text);
  assert.ok(!html.includes("THE PERMISSION MACHINE"), "Former diagram layout is gone");
  const media = await fetch(base + "/motion/protocol-story.mp4", {signal: AbortSignal.timeout(60000)});
  assert.equal(media.status, 200); assert.match(media.headers.get("content-type") || "", /video\/mp4/);
  const mediaBuffer = Buffer.from(await media.arrayBuffer());
  assert.ok(mediaBuffer.includes(Buffer.from("ftyp")), "Real MP4 container");
  assert.ok(mediaBuffer.length > 100000 && mediaBuffer.length <= 8 * 1024 * 1024, "Film size budget");
  const poster = await fetch(base + "/motion/protocol-story-poster.jpg", {signal: AbortSignal.timeout(30000)});
  assert.equal(poster.status, 200); assert.match(poster.headers.get("content-type") || "", /image\/jpeg/);
  const posterBuffer = Buffer.from(await poster.arrayBuffer());
  assert.equal(posterBuffer[0], 255); assert.equal(posterBuffer[1], 216);
  assert.ok(posterBuffer.length <= 300 * 1024, "Poster size budget");
  recordCheck("public server-rendered narrative and actual MP4/JPEG delivery");

  browser = await chromium.launch({headless: true, args: ["--enable-unsafe-swiftshader"]});
  if (process.env.STORY_GPU_PROBE === "1") {await verifyGpu(browser, base); assert.deepEqual(errors, []); console.log("STORY_GPU_VERIFIED"); break mainChecks}
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: "no-preference"});
  await trackAudio(context);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if (message.type() === "error" || message.type() === "warning") consoles.push(message.text())});
  await page.goto(base + "/why-we-exist", {waitUntil: "domcontentloaded"});
  await page.getByRole("heading", {name: "INTELLIGENCE. WITH PERMISSION.", level: 1}).waitFor();
  await Promise.race([rendererReady(page), page.getByRole("alert").filter({hasText: "The 3D scene is unavailable."}).waitFor({timeout: 60000}).then(() => {throw Error("The real renderer entered its fallback: " + consoles.join(" | "))})]);
  if (process.env.STORY_PROBE === "1") {
    await probePage(page);
    await bounded(context.close(), "live context close", 5000).catch(error => console.log(String(error)));
    const staticContext = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: "reduce"});
    const staticPage = await staticContext.newPage();
    await staticPage.goto(base + "/why-we-exist", {waitUntil: "domcontentloaded"});
    await rendererReady(staticPage);
    await probeState(staticPage, "reduced-before-key");
    await bounded(staticPage.keyboard.press("PageDown"), "reduced key", 5000);
    await delay(500); await probeState(staticPage, "reduced-after-key");
    await bounded(staticPage.screenshot({path: new URL("probe-reduced.png", folder).pathname, timeout: 5000}), "reduced screenshot", 5500).catch(error => console.log(String(error)));
    await staticContext.close();
    console.log("STORY_PROBE_CONSOLES", JSON.stringify(consoles));
    break mainChecks;
  }
  assert.equal(await page.locator("video").count(), 0, "Film is opt-in");
  assert.deepEqual(await audioStates(page), [], "No AudioContext before user approval");
  assert.equal(await page.locator("[data-story-journey]").getAttribute("data-story-audio"), "off");
  await noOverflow(page);
  await heroActionsDistinct(page);
  await page.screenshot({path: new URL("hero-1440.png", folder).pathname});

  await page.evaluate(() => {if (document.activeElement instanceof HTMLElement) document.activeElement.blur()});
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => scrollY > 100);
  await page.mouse.wheel(0, 250);
  await page.waitForFunction(() => Number(document.querySelector("[data-story-journey]")?.getAttribute("data-progress")) > .05);
  await stageAt(page, 0);
  recordCheck("native keyboard PageDown and wheel scroll advance the story");

  const firstFrame = await frames(page);
  await page.waitForFunction(before => Number(document.querySelector("[data-story-renderer]")?.getAttribute("data-story-frame")) > before + 2, firstFrame, {timeout: 30000});
  const initial = await sceneSnapshot(page, "scene-hero");
  assert.ok(new Set(initial.pixels.filter((_, index) => index % 4 !== 3)).size > 30, "Rendered geometry has material/shadow variation");
  await page.mouse.move(1250, 560); await delay(1000);
  const pointer = await sceneSnapshot(page, "scene-pointer");
  const pointerDifference = difference(initial.pixels, pointer.pixels);
  assert.ok(pointerDifference.ratio > .001, "Actual WebGL pixels respond to pointer/idle");
  visual.push({kind: "pointer", ...pointerDifference});
  recordCheck("actual WebGL frames, physical material pixels and pointer/idle motion");

  await page.getByRole("button", {name: "Pause scene", exact: true}).focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("[data-story-journey]")?.getAttribute("data-paused") === "true");
  await delay(200);
  const pausedA = await sceneSnapshot(page, "scene-paused-a"), pausedFrame = await frames(page);
  await delay(450);
  const pausedB = await sceneSnapshot(page, "scene-paused-b");
  assert.equal(await frames(page), pausedFrame, "Paused renderer does not keep drawing");
  assert.equal(pausedA.hash, pausedB.hash, "Paused WebGL pixels remain still");
  await page.getByRole("button", {name: "Resume scene", exact: true}).focus(); await page.keyboard.press("Enter");
  const resumedFrame = await frames(page);
  await page.waitForFunction(before => Number(document.querySelector("[data-story-renderer]")?.getAttribute("data-story-frame")) > before, resumedFrame);
  recordCheck("keyboard pause/resume freezes actual rendered pixels and frame loop");

  await page.getByRole("button", {name: "Turn scene sound on", exact: true}).click();
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).some(context => context.state === "running"));
  assert.equal(await page.evaluate(() => ((window as typeof window & {__storyOscillators?: OscillatorNode[]}).__storyOscillators || []).length), 4, "Original score has actual oscillators");
  await page.getByRole("slider", {name: "Scene volume", exact: true}).focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("slider", {name: "Scene volume", exact: true}).inputValue(), "1");
  await page.keyboard.press("End"); await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getByRole("slider", {name: "Scene volume", exact: true}).inputValue(), "99");

  let previous = initial, firstProgress = 0, lastProgress = 0;
  for (const [index, id] of ids.entries()) {
    await stageAt(page, index); await delay(1200);
    const progress = Number(await page.locator("[data-story-journey]").getAttribute("data-progress"));
    if (!index) firstProgress = progress; if (index === 5) lastProgress = progress;
    const pose = await sceneSnapshot(page, "scene-" + id);
    if (index > 0) {
      const change = difference(previous.pixels, pose.pixels);
      assert.ok(change.ratio > .035 && change.mean > 1, "Actual rendered camera/objects change for " + id);
      visual.push({kind: "pose", id, ...change, hash: pose.hash});
    }
    previous = pose;
    await page.screenshot({path: new URL(id + "-1440.png", folder).pathname});
  }
  assert.ok(lastProgress - firstProgress > .95, "Native scroll traverses all six scene poses");
  assert.ok(await page.evaluate(() => ((window as typeof window & {__storyOscillators?: OscillatorNode[]}).__storyOscillators || []).length) > 4, "Scroll crossings create actual cue oscillators");

  await stageAt(page, 2); await delay(1000);
  await page.getByRole("button", {name: "Show blocked path", exact: true}).click();
  await page.getByRole("status").filter({hasText: "BLOCKED / REVIEW SKIPPED / NO TRANSFER"}).waitFor();
  await delay(800);
  await page.screenshot({path: new URL("blocked-path-1440.png", folder).pathname});
  const blockedGate = await sceneSnapshot(page, "scene-blocked-gate");
  await stageAt(page, 3); await page.getByRole("heading", {name: "This review never starts.", level: 2}).waitFor();
  await stageAt(page, 4); await page.getByRole("heading", {name: "The funds stay put.", level: 2}).waitFor(); await delay(1000);
  const blockedTransfer = await sceneSnapshot(page, "scene-blocked-transfer");
  assert.notEqual(blockedGate.hash, blockedTransfer.hash, "Blocked path retains authored camera composition");
  await page.screenshot({path: new URL("blocked-transfer-1440.png", folder).pathname});
  await stageAt(page, 2); await page.getByRole("button", {name: "Show permitted path", exact: true}).click();
  await stageAt(page, 4); await delay(1000);
  const permittedTransfer = await sceneSnapshot(page, "scene-permitted-transfer");
  const branchDifference = difference(blockedTransfer.pixels, permittedTransfer.pixels);
  assert.ok(branchDifference.ratio > .001, "The actual settlement rendering differs between blocked/permitted paths");
  visual.push({kind: "blocked-transfer", ...branchDifference});
  await stageAt(page, 2);
  const cueBaseline = Number(await page.locator("[data-story-journey]").getAttribute("data-audio-cues"));
  for (let index = 0; index < 6; index++) {await page.evaluate(offset => scrollBy({top: offset, behavior: "instant"}), index % 2 ? 4 : -4); await delay(120)}
  assert.equal(Number(await page.locator("[data-story-journey]").getAttribute("data-audio-cues")), cueBaseline, "Small scrolls do not burst duplicate cues");
  recordCheck("six distinct rendered poses, truthful skipped review/no transfer branch and original scroll cues");

  await page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).every(context => context.state === "suspended"));
  await delay(150); const hiddenFrame = await frames(page); await delay(250); assert.equal(await frames(page), hiddenFrame);
  await page.evaluate(() => {delete (document as unknown as {hidden?: boolean}).hidden; document.dispatchEvent(new Event("visibilitychange"))});
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).some(context => context.state === "running"));
  // A test-only continuation makes genuine offscreen native scrolling possible beyond the short production footer.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.dataset.storyTestContinuation = "true";
    spacer.style.height = innerHeight * 2 + "px";
    document.body.appendChild(spacer);
    scrollTo({top: document.documentElement.scrollHeight, behavior: "instant"});
  });
  await page.waitForFunction(() => (document.querySelector("[data-story-viewport]")?.getBoundingClientRect().bottom || 0) < 0);
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).every(context => context.state === "suspended"));
  await delay(150);
  const offscreenFrame = await frames(page); await delay(250); assert.equal(await frames(page), offscreenFrame, "A genuinely offscreen scene stops rendering");
  await page.evaluate(() => document.querySelector("[data-story-test-continuation]")?.remove());
  await stageAt(page, 0);
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).some(context => context.state === "running"));
  recordCheck("real hidden/offscreen suspension of AudioContext and renderer; native offscreen fixture uses test-only continuation spacer");

  await page.getByRole("button", {name: "Watch protocol film", exact: true}).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).every(context => context.state === "suspended"));
  const film = page.locator("video[aria-label='IntentGuard protocol story film']");
  await page.waitForFunction(() => {const video = document.querySelector("video"); return !!video && video.readyState >= 2 && !video.error}, undefined, {timeout: 45000});
  await page.waitForFunction(() => document.querySelector("[data-story-film]")?.getAttribute("data-film-state") !== "loading");
  assert.equal(await film.evaluate(element => (element as HTMLVideoElement).muted), true);
  assert.equal(await film.evaluate(element => element.hasAttribute("autoplay")), false);
  const duration = await film.evaluate(element => (element as HTMLVideoElement).duration);
  assert.ok(duration >= 24 && duration <= 32);
  assert.equal(await film.evaluate(element => getComputedStyle(element).visibility), "visible", "Decoded video replaces poster");
  if (await page.getByRole("button", {name: "Pause film", exact: true}).count()) await page.getByRole("button", {name: "Pause film", exact: true}).click();
  await page.getByRole("button", {name: "Play story with sound", exact: true}).click();
  await page.waitForFunction(() => {const video = document.querySelector("video"); return !!video && !video.paused && !video.muted && video.volume > 0});
  await page.getByRole("button", {name: "Pause film", exact: true}).focus(); await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("video")?.paused === true);
  await page.getByRole("button", {name: "Play film", exact: true}).focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("video")?.paused === false);
  await page.getByRole("button", {name: "Mute film sound", exact: true}).click();
  assert.equal(await film.evaluate(element => (element as HTMLVideoElement).muted), true);
  await page.getByRole("button", {name: "Turn film sound on", exact: true}).click();
  assert.equal(await film.evaluate(element => (element as HTMLVideoElement).muted), false);
  await page.getByRole("slider", {name: "Film volume"}).focus(); await page.keyboard.press("End"); await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => Math.abs((document.querySelector("video")?.volume || 0) - .99) < .001);
  assert.equal(await page.evaluate(() => localStorage.getItem("intentguard-story-volume")), "0.99");
  await page.getByRole("button", {name: "Replay film", exact: true}).click();
  await page.waitForFunction(() => {const video = document.querySelector("video"); return !!video && !video.seeking && video.currentTime < 2 && !video.paused});
  const filmTime = await film.evaluate(element => (element as HTMLVideoElement).currentTime);
  await page.waitForFunction(time => (document.querySelector("video")?.currentTime || 0) > time + .2, filmTime);
  await film.evaluate(element => {const video = element as HTMLVideoElement; video.currentTime = video.duration - .08});
  await page.waitForFunction(() => document.querySelector("video")?.ended === true);
  await page.getByRole("button", {name: "Replay story with sound", exact: true}).waitFor();
  await page.getByRole("button", {name: "Replay film", exact: true}).click();
  await page.waitForFunction(() => {const video = document.querySelector("video"); return !!video && !video.paused && !video.ended && !video.seeking && video.currentTime < 2});
  await page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');
  await page.waitForFunction(() => document.querySelector("video")?.paused === true);
  await page.evaluate(() => {delete (document as unknown as {hidden?: boolean}).hidden; document.dispatchEvent(new Event("visibilitychange"))});
  await page.waitForFunction(() => document.querySelector("video")?.paused === false);
  await page.getByText("Film transcript and sound", {exact: true}).click();
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw Error("Film dialog is absent");
    const spacer = document.createElement("div");
    spacer.dataset.filmTestContinuation = "true"; spacer.style.height = innerHeight * 2 + "px";
    dialog.appendChild(spacer); dialog.scrollTop = dialog.scrollHeight;
  });
  await page.waitForFunction(() => (document.querySelector("[data-story-film]")?.getBoundingClientRect().bottom || 0) < 0);
  await page.waitForFunction(() => document.querySelector("video")?.paused === true);
  await page.evaluate(() => {document.querySelector("[data-film-test-continuation]")?.remove(); const dialog = document.querySelector<HTMLElement>('[role="dialog"]'); if (dialog) dialog.scrollTop = 0});
  await page.waitForFunction(() => document.querySelector("video")?.paused === false);
  assert.ok((await page.locator("details[open]").innerText()).includes("GenLayer review is skipped"));
  await page.screenshot({path: new URL("film-dialog-1440.png", folder).pathname});
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("video").count(), 0, "Closing film disposes video");
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).some(context => context.state === "running"));
  assert.equal(await page.getByRole("button", {name: "Watch protocol film", exact: true}).evaluate(element => element === document.activeElement), true, "Dialog restores keyboard focus");
  recordCheck("opt-in film, actual playback/ending/replay, keyboard, mute/volume, transcript, tab suspension and sound handoff");

  for (const width of widths) {
    await page.setViewportSize({width, height: 1000}); await stageAt(page, 0); await noOverflow(page);
    await page.getByRole("button", {name: "Pause scene", exact: true}).click();
    await page.waitForFunction(() => document.querySelector("[data-story-journey]")?.getAttribute("data-paused") === "true");
    await delay(600);
    await heroActionsDistinct(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.screenshot({path: new URL("hero-" + width + ".png", folder).pathname});
    await page.getByRole("button", {name: "Resume scene", exact: true}).click();
    for (let index = 1; index < ids.length; index++) {await stageAt(page, index); await noOverflow(page)}
    if (width <= 768) await page.screenshot({path: new URL("receipt-" + width + ".png", folder).pathname});
  }
  recordCheck("all six chapters have no overflow at 320/390/768/1440/1920");

  for (const viewport of shortViewports) {
    await page.setViewportSize(viewport); await stageAt(page, 0); await noOverflow(page);
    await heroActionsDistinct(page);
    await page.screenshot({path: new URL("hero-actions-" + viewport.width + "x" + viewport.height + ".png", folder).pathname});
  }
  recordCheck("film and scroll actions have separate visible touch targets across desktop mobile and short heights");

  // Suspend the previous animated canvas while reviewing a fresh device context.
  await page.getByRole("button", {name: "Pause scene", exact: true}).click();
  const portraitContext = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: "no-preference"});
  const portraitPage = await portraitContext.newPage();
  portraitPage.on("pageerror", error => errors.push(error.message));
  await portraitPage.goto(base + "/why-we-exist", {waitUntil: "domcontentloaded"});
  await rendererReady(portraitPage);
  await portraitPage.getByRole("button", {name: "Pause scene", exact: true}).click();
  await portraitPage.waitForFunction(() => document.querySelector("[data-story-journey]")?.getAttribute("data-paused") === "true");
  await delay(600); await noOverflow(portraitPage);
  await heroActionsDistinct(portraitPage);
  await portraitPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await portraitPage.screenshot({path: new URL("hero-390x844.png", folder).pathname});
  await portraitContext.close();
  await page.getByRole("button", {name: "Resume scene", exact: true}).click();
  recordCheck("fresh portrait hero uses the actual initial camera pose at 390x844");

  await page.setViewportSize({width: 1440, height: 1000}); await stageAt(page, 0);
  await page.getByRole("button", {name: "Turn scene sound off", exact: true}).click();
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.waitForFunction(() => document.querySelector("[data-story-journey]")?.getAttribute("data-reduced-motion") === "true");
  await delay(200);
  const reducedA = await sceneSnapshot(page, "scene-reduced-a");
  await stageAt(page, 4); await delay(200);
  const reducedB = await sceneSnapshot(page, "scene-reduced-b");
  assert.equal(reducedA.hash, reducedB.hash, "Reduced motion locks actual scene pixels through scroll");
  await stageAt(page, 0);
  await page.getByRole("button", {name: "Watch protocol film", exact: true}).click();
  await page.waitForFunction(() => {const video = document.querySelector("video"); return !!video && video.readyState >= 2}, undefined, {timeout: 45000});
  assert.equal(await film.evaluate(element => (element as HTMLVideoElement).paused), true, "Reduced motion film never autoplays");
  await page.getByRole("button", {name: "Play story with sound", exact: true}).click();
  await page.waitForFunction(() => document.querySelector("video")?.paused === false);
  await page.keyboard.press("Escape");
  assert.deepEqual(await audioStates(page), ["suspended"], "Closing film does not invent scene sound permission");
  recordCheck("reduced motion gives static rendered pose, no film autoplay and deliberate playback");

  const failedContext = await browser.newContext({viewport: {width: 390, height: 900}, reducedMotion: "reduce"});
  const failedPage = await failedContext.newPage(); failedPage.on("pageerror", error => errors.push(error.message));
  await failedContext.route("**/motion/protocol-story.mp4", route => route.abort("failed"));
  await failedPage.goto(base + "/why-we-exist", {waitUntil: "domcontentloaded"});
  await rendererReady(failedPage);
  await failedPage.getByRole("button", {name: "Watch protocol film", exact: true}).click();
  await failedPage.getByRole("alert").filter({hasText: "The film could not load."}).waitFor({timeout: 30000});
  assert.equal(await failedPage.locator("[data-story-film] img").evaluate(element => (element as HTMLImageElement).naturalWidth > 0), true, "Failure preserves decoded poster");
  await noOverflow(failedPage);
  await failedPage.screenshot({path: new URL("film-error-390.png", folder).pathname});
  await failedContext.unroute("**/motion/protocol-story.mp4");
  await failedPage.getByRole("button", {name: "Retry film", exact: true}).click();
  await failedPage.waitForFunction(() => {const video = document.querySelector("video"); return !!video && video.readyState >= 2 && !video.error}, undefined, {timeout: 45000});
  assert.equal(await failedPage.getByRole("alert").filter({hasText: "The film could not load."}).count(), 0);
  await failedPage.keyboard.press("Escape"); await failedContext.close();
  recordCheck("real media network failure displays poster/transcript and retry recovers actual video");

  await verifyGpu(browser, base);

  await page.getByRole("button", {name: "Turn scene sound on", exact: true}).click();
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).some(context => context.state === "running"));
  await page.locator("a[href='/docs/architecture']").click();
  await page.waitForURL("**/docs/architecture");
  await page.waitForFunction(() => ((window as typeof window & {__storyContexts?: AudioContext[]}).__storyContexts || []).every(context => context.state === "closed"));
  recordCheck("route navigation closes actual AudioContext");

  assert.deepEqual(errors, []);
  await writeFile(new URL("browser-report.json", folder), JSON.stringify({
    mode: external ? "HOSTED_REAL_WEBGL_AND_MEDIA" : "PRODUCTION_REAL_WEBGL_AND_MEDIA", base, viewports: widths,
    media: {bytes: mediaBuffer.length, posterBytes: posterBuffer.length, duration}, checks, visual, pageErrors: errors
  }, null, 2));
  console.log("Story browser verification passed");
 }
} catch (error) {
  await writeFile(new URL("failure-report.json", folder), JSON.stringify({base, error: error instanceof Error ? error.stack : String(error), checks, consoles}, null, 2));
  console.error("STORY_FAILURE", error instanceof Error ? error.stack : String(error), consoles);
  if (browser) for (const context of browser.contexts()) for (const [index, page] of context.pages().entries()) {
    await page.screenshot({path: new URL("diagnostic-" + index + ".png", folder).pathname, timeout: 5000}).catch(() => {});
    console.error("STORY_DIAGNOSTIC", JSON.stringify({
      url: page.url(),
      renderer: await page.locator("[data-story-renderer]").getAttribute("data-story-renderer", {timeout: 1000}).catch(() => null),
      stage: await page.locator("[data-story-journey]").getAttribute("data-active", {timeout: 1000}).catch(() => null),
      film: await page.locator("video").evaluate(element => {const video = element as HTMLVideoElement; return {paused: video.paused, muted: video.muted, readyState: video.readyState, currentTime: video.currentTime, duration: video.duration, error: video.error?.message}}, undefined, {timeout: 1000}).catch(() => null),
      alerts: await page.getByRole("alert").allTextContents(), errors, consoles
    }));
  }
  if (output) console.error(output.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  if (server) {
    if (process.platform === "win32") server.kill("SIGTERM");
    else if (server.pid) try {process.kill(-server.pid, "SIGTERM")} catch {server.kill("SIGTERM")}
  }
}
