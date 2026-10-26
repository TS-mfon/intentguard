"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import {Component, useCallback, useEffect, useRef, useState, type ReactNode} from "react";
import {ArrowDown, ArrowRight, ArrowUpRight, Pause, Play, RotateCcw, Volume2, VolumeX, X} from "lucide-react";
import {BrandMark} from "./brand";
import styles from "./why-we-exist.module.css";

const StoryScene = dynamic(() => import("./story-scene"), {ssr: false});
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const chapterIds = ["the-instruction", "the-mandate", "the-circuit", "the-evidence", "the-transfer", "the-receipt"];
const filmCues = [
  {from: 0, text: "An agent prepares a purchasing request against the human mandate."},
  {from: 4.7, text: "The human-issued ATM card enters the permission reader."},
  {from: 8.3, text: "An over-limit request is blocked. GenLayer review is skipped."},
  {from: 12, text: "A new permitted request passes TapeOut and reserves its budget."},
  {from: 15.7, text: "GenLayer reviews committed evidence with independent validator evaluation."},
  {from: 20.3, text: "The X Layer vault rechecks permission before exact settlement."},
  {from: 24, text: "The merchant receives tokens. The receipt connects intent, review and payment."}
];

class SceneBoundary extends Component<{children: ReactNode; onError: (message: string) => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true}}
  componentDidCatch(error: Error) {this.props.onError(error.message)}
  render() {return this.state.failed ? null : this.props.children}
}

type Score = {context: AudioContext; master: GainNode; oscillators: OscillatorNode[]};
function useSceneSound({active, blocked, suspended, reduced}: {active: number; blocked: boolean; suspended: boolean; reduced: boolean}) {
  const score = useRef<Score | null>(null), epoch = useRef(0), stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previous = useRef({active, blocked}), lastCue = useRef(0), running = useRef(false), wanted = useRef(false), seenCues = useRef(new Set<string>());
  const [enabled, setEnabled] = useState(false), [unavailable, setUnavailable] = useState(false), [volume, setVolume] = useState(.65), [cueCount, setCueCount] = useState(0);
  const disposed = useRef(false);

  const stop = useCallback(() => {
    ++epoch.current;
    running.current = false;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    const value = score.current;
    if (!value || value.context.state === "closed") return;
    const now = value.context.currentTime;
    value.master.gain.cancelScheduledValues(now);
    value.master.gain.setTargetAtTime(0, now, .012);
    stopTimer.current = setTimeout(() => {void value.context.suspend().catch(() => {})}, 60);
  }, []);

  const create = useCallback(() => {
    if (score.current) return score.current;
    const Audio = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Audio) {setUnavailable(true); return null}
    try {
      const context = new Audio(), master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      // A quiet, original four-note mechanical score. No fetched or third-party audio.
      const oscillators = [55, 82.4069, 110, 164.8138].map((frequency, index) => {
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = index === 1 ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        oscillator.detune.value = index % 2 ? 3 : -3;
        gain.gain.value = index < 2 ? .028 : .012;
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start();
        return oscillator;
      });
      score.current = {context, master, oscillators};
      return score.current;
    } catch {setUnavailable(true); return null}
  }, []);

  function toggle() {
    if (wanted.current) {wanted.current = false; setEnabled(false); stop(); return}
    const value = create();
    if (!value) return;
    wanted.current = true;
    setEnabled(true);
    // Start/resume is invoked in this user gesture, before any awaited work.
    if (!suspended) void value.context.resume().catch(() => {if (!disposed.current) setUnavailable(true)});
  }

  useEffect(() => {
    if (!enabled || suspended || unavailable) {stop(); return}
    const value = score.current;
    if (!value) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    const attempt = ++epoch.current;
    void value.context.resume().then(() => {
      if (disposed.current || attempt !== epoch.current || !wanted.current) return;
      const now = value.context.currentTime;
      value.master.gain.cancelScheduledValues(now);
      value.master.gain.setTargetAtTime(volume, now, .15);
      running.current = true;
      previous.current = {active, blocked};
    }).catch(() => {if (!disposed.current) setUnavailable(true)});
    return stop;
    // The ambient bed continues between acts. Cue changes are handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, suspended, unavailable, stop]);

  useEffect(() => {
    const value = score.current;
    if (value && running.current) value.master.gain.setTargetAtTime(volume, value.context.currentTime, .05);
  }, [volume]);

  useEffect(() => {
    const was = previous.current;
    previous.current = {active, blocked};
    const value = score.current;
    if (!value || !running.current || suspended || reduced || (was.active === active && was.blocked === blocked)) return;
    const now = value.context.currentTime;
    if (active === 0 && was.active > 1) seenCues.current.clear();
    const cueKey = String(active) + (blocked ? "-blocked" : "-permitted");
    if (now - lastCue.current < .8 || seenCues.current.has(cueKey)) return;
    seenCues.current.add(cueKey);
    lastCue.current = now;
    const denial = blocked && active >= 2, confirmation = active >= 4 && !blocked;
    const oscillator = value.context.createOscillator(), envelope = value.context.createGain();
    oscillator.type = denial ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(denial ? 105 : confirmation ? 440 : 170, now);
    oscillator.frequency.exponentialRampToValueAtTime(denial ? 42 : confirmation ? 660 : 260, now + .18);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(.12, now + .018);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + .36);
    oscillator.connect(envelope);
    envelope.connect(value.master);
    oscillator.start(now);
    oscillator.stop(now + .4);
    oscillator.onended = () => {oscillator.disconnect(); envelope.disconnect()};
    setCueCount(value => value + 1);
  }, [active, blocked, suspended, reduced]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      wanted.current = false;
      ++epoch.current;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      const value = score.current;
      if (value) {value.oscillators.forEach(oscillator => {oscillator.stop(); oscillator.disconnect()}); void value.context.close().catch(() => {})}
      score.current = null;
    };
  }, []);

  return {enabled, volume, setVolume, toggle, stop, unavailable, cueCount, state: unavailable ? "unavailable" : !enabled ? "off" : suspended ? "suspended" : "playing"};
}

function StoryFilm() {
  const film = useRef<HTMLVideoElement>(null), frame = useRef<HTMLDivElement>(null), desired = useRef(false), visible = useRef(true), started = useRef(false), playAttempt = useRef(0);
  const [reduced, setReduced] = useState(true), [ready, setReady] = useState(false), [playing, setPlaying] = useState(false), [muted, setMuted] = useState(true), [volume, setVolume] = useState(.65), [error, setError] = useState(false), [slow, setSlow] = useState(false), [ended, setEnded] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  const sync = useCallback(() => {
    const video = film.current;
    if (!video) return;
    const attempt = ++playAttempt.current;
    if (desired.current && visible.current && !document.hidden && !video.error) {
      void video.play().catch(() => {
        if (attempt !== playAttempt.current || !desired.current || !visible.current || document.hidden) return;
        setPlaying(false);
        desired.current = false;
      });
    } else video.pause();
  }, []);

  useEffect(() => {
    const video = film.current;
    if (!video) return;
    const source = video.querySelector("source");
    const observe = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setTime(video.currentTime);
      setPlaying(!video.paused && !video.ended);
      setEnded(video.ended);
      if (video.readyState >= 2 && !video.error) {setReady(true); setError(false); setSlow(false)}
    };
    const failed = () => {++playAttempt.current; desired.current = false; video.pause(); setError(true); setPlaying(false)};
    const finished = () => {desired.current = false; setPlaying(false); setEnded(true)};
    const events = ["loadedmetadata", "loadeddata", "canplay", "play", "pause", "timeupdate"];
    for (const event of events) video.addEventListener(event, observe);
    video.addEventListener("error", failed);
    source?.addEventListener("error", failed);
    video.addEventListener("ended", finished);
    // Events can precede hydration. Read the browser's existing media state.
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) failed(); else observe();
    return () => {
      for (const event of events) video.removeEventListener(event, observe);
      video.removeEventListener("error", failed);
      source?.removeEventListener("error", failed);
      video.removeEventListener("ended", finished);
    };
  }, []);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(query.matches);
      if (query.matches) {desired.current = false; ++playAttempt.current; film.current?.pause()}
      else if (!started.current) {started.current = true; desired.current = true; sync()}
    };
    update();
    query.addEventListener("change", update);
    const video = film.current, onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new IntersectionObserver(([entry]) => {visible.current = entry.isIntersecting; sync()}, {threshold: .1});
    if (frame.current) observer.observe(frame.current);
    try {
      const saved = localStorage.getItem("intentguard-story-volume");
      if (saved !== null && Number.isFinite(Number(saved))) setVolume(clamp(Number(saved)));
    } catch {}
    return () => {
      query.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      desired.current = false;
      ++playAttempt.current;
      video?.pause();
    };
  }, [sync]);

  useEffect(() => {const video = film.current; if (video) {video.muted = muted; video.volume = volume}}, [muted, volume]);
  useEffect(() => {if (ready || error) return; const timer = setTimeout(() => setSlow(true), 10000); return () => clearTimeout(timer)}, [ready, error]);

  function play(withSound = false) {
    const video = film.current;
    if (!video) return;
    if (ended) {video.currentTime = 0; setEnded(false)}
    if (withSound) {video.muted = false; setMuted(false); if (volume === 0) {video.volume = .65; setVolume(.65)}}
    desired.current = true;
    sync();
  }
  function toggle() {if (playing) {desired.current = false; ++playAttempt.current; film.current?.pause()} else play()}
  function sound() {if (muted) play(true); else {if (film.current) film.current.muted = true; setMuted(true)}}
  function replay() {const video = film.current; if (!video) return; video.currentTime = 0; setTime(0); setEnded(false); play()}
  function retry() {setError(false); setReady(false); setSlow(false); setEnded(false); desired.current = !reduced; film.current?.load(); sync()}
  const cue = (filmCues.filter(cue => time >= cue.from).at(-1) || filmCues[0]).text;

  return <div ref={frame} className={styles.film} data-story-film data-film-state={error ? "error" : ended ? "ended" : playing ? "playing" : ready ? "paused" : "loading"}>
    <div className={styles.filmScreen}>
      <img src="/motion/protocol-story-poster.jpg" alt="An IntentGuard terminal agent presents its ATM card to a mechanical permission gate." width="1920" height="1080" className={styles.filmPoster}/>
      <video ref={film} className={ready && !error ? styles.video : styles.videoWaiting} poster="/motion/protocol-story-poster.jpg" preload="auto" playsInline muted aria-label="IntentGuard protocol story film">
        <source src="/motion/protocol-story.mp4" type="video/mp4"/>
      </video>
      {!error && (!playing || ended) && <div className={styles.filmInvitation}><button onClick={() => play(true)} className={styles.soundPlay}><Play size={20} fill="currentColor"/>{ended ? "Replay story with sound" : "Play story with sound"}</button></div>}
      {!ready && !error && <div className={styles.loadingNote} role="status">{slow ? "The film is taking longer to load. You can read the complete transcript below." : "Preparing the protocol film…"}</div>}
      {error && <div className={styles.filmError} role="alert"><p>The film could not load. The full story and transcript are still available.</p><button onClick={retry}>Retry film<RotateCcw size={16}/></button></div>}
      <div className={styles.filmProgress} aria-hidden="true"><span style={{width: duration ? clamp(time / duration) * 100 + "%" : "0%"}}/></div>
    </div>
    <div className={styles.filmControls} aria-label="Story film controls">
      <button onClick={toggle} aria-label={playing ? "Pause film" : "Play film"} disabled={error}>{playing ? <Pause size={18}/> : <Play size={18}/>}<span>{playing ? "Pause" : "Play"}</span></button>
      <button onClick={sound} aria-label={muted ? "Turn film sound on" : "Mute film sound"} aria-pressed={!muted}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}<span>{muted ? "Muted" : "Sound on"}</span></button>
      <label className={styles.filmVolume}><span>Volume</span><input type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} aria-label="Film volume" aria-valuetext={Math.round(volume * 100) + " percent"} onChange={event => {
        const value = Number(event.target.value) / 100;
        setVolume(value);
        try {localStorage.setItem("intentguard-story-volume", String(value))} catch {}
      }}/></label>
      <button onClick={replay} aria-label="Replay film" disabled={error}><RotateCcw size={17}/><span>Replay</span></button>
      <span className={styles.filmTime}>{Math.floor(time).toString().padStart(2, "0")} / {Math.round(duration || 28)}s</span>
    </div>
    <p className={styles.filmCaption}>{cue}</p>
    <details className={styles.transcript}><summary>Film transcript and sound</summary><p>The agent forms a purchasing request and presents its human-issued card. An over-limit request fails the TapeOut gate: GenLayer review is skipped and no transfer occurs. A new permitted request passes the circuit and reserves budget. GenLayer checks committed evidence with independent validator evaluation. The X Layer vault rechecks the exact limits before settlement. The merchant then receives tokens and a receipt. Card contact, mechanical gates, computation and confirmation have original synchronized stereo sound. This is a protocol illustration; depicted transfers do not represent live activity.</p></details>
  </div>;
}

export function WhyWeExist() {
  const journey = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), frozenProgress = useRef(0);
  const [progress, setProgress] = useState(0), [active, setActive] = useState(0), [blocked, setBlocked] = useState(false), [paused, setPaused] = useState(false), [reduced, setReduced] = useState(true), [hidden, setHidden] = useState(false), [inView, setInView] = useState(true), [filmOpen, setFilmOpen] = useState(false), [sceneReady, setSceneReady] = useState(false), [sceneError, setSceneError] = useState(""), [sceneVersion, setSceneVersion] = useState(0);
  const suspended = paused || hidden || !inView || filmOpen || !!sceneError;
  const audio = useSceneSound({active, blocked, suspended, reduced});
  if (!suspended && !reduced) frozenProgress.current = progress;
  const onReady = useCallback(() => {setSceneReady(true); setSceneError("")}, []);
  const onError = useCallback((message: string) => {setSceneError(message || "The renderer could not start."); setSceneReady(false)}, []);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(query.matches), updateVisibility = () => setHidden(document.hidden);
    updateMotion(); updateVisibility();
    query.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {threshold: .08});
    if (viewport.current) observer.observe(viewport.current);
    let tick = 0;
    const update = () => {
      tick = 0;
      const root = journey.current, stage = viewport.current;
      if (!root || !stage) return;
      const header = parseFloat(getComputedStyle(root).getPropertyValue("--story-header")) || 0;
      const top = root.getBoundingClientRect().top + scrollY - header;
      const value = clamp((scrollY - top) / Math.max(1, root.offsetHeight - stage.offsetHeight));
      setProgress(value);
      setActive(Math.min(5, Math.round(value * 5)));
    };
    const schedule = () => {if (!tick) tick = requestAnimationFrame(update)};
    addEventListener("scroll", schedule, {passive: true});
    addEventListener("resize", schedule, {passive: true});
    schedule();
    return () => {
      query.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(tick);
    };
  }, []);

  function retryScene() {setSceneError(""); setSceneReady(false); setSceneVersion(version => version + 1)}
  function openFilm() {audio.stop(); setFilmOpen(true)}

  return <main id="main" className={styles.storyPage}>
    <div ref={journey} className={styles.journey} data-story-journey data-progress={progress.toFixed(4)} data-active={active} data-blocked={blocked ? "true" : "false"} data-paused={paused ? "true" : "false"} data-reduced-motion={reduced ? "true" : "false"} data-story-audio={audio.state} data-audio-cues={audio.cueCount}>
      <div ref={viewport} className={styles.viewport} data-story-viewport>
        <div className={styles.posterBackdrop} data-scene-poster style={{visibility: sceneReady && !sceneError ? "hidden" : "visible"}} aria-hidden="true"><img src="/motion/protocol-story-poster.jpg" alt="" width="1920" height="1080"/></div>
        {!sceneError && <div className={styles.scene}><SceneBoundary key={sceneVersion} onError={onError}><StoryScene progress={reduced ? 0 : frozenProgress.current} blocked={blocked} paused={suspended} reducedMotion={reduced} onReady={onReady} onError={onError}/></SceneBoundary></div>}
        <div className={styles.readingShade} aria-hidden="true" data-story-reading-shade data-side={active === 1 || active === 3 ? "right" : "left"}/>
        {!sceneReady && !sceneError && <div className={styles.sceneLoading} role="status"><BrandMark size={18}/>Preparing the 3D scene</div>}
        {sceneError && <div className={styles.sceneFallback} role="alert"><p>The 3D scene is unavailable. The story and film are still available.</p><button onClick={retryScene}>Retry 3D scene<RotateCcw size={17}/></button></div>}
        <div className={styles.sceneControls} aria-label="Scene controls">
          <div className={styles.sceneButtons}>
            <button onClick={() => setPaused(value => !value)} aria-label={paused ? "Resume scene" : "Pause scene"} aria-pressed={paused} disabled={reduced}>{paused ? <Play size={18}/> : <Pause size={18}/>}</button>
            <button onClick={audio.toggle} aria-label={audio.enabled ? "Turn scene sound off" : "Turn scene sound on"} aria-pressed={audio.enabled} disabled={audio.unavailable}>{audio.enabled ? <Volume2 size={19}/> : <VolumeX size={19}/>}<span>{audio.unavailable ? "Unavailable" : audio.enabled ? "Sound on" : "Sound off"}</span></button>
            <label className={styles.sceneVolume}><span className="sr-only">Scene volume</span><input type="range" min="0" max="100" step="1" value={Math.round(audio.volume * 100)} aria-label="Scene volume" aria-valuetext={Math.round(audio.volume * 100) + " percent"} onChange={event => audio.setVolume(Number(event.target.value) / 100)}/></label>
          </div>
          <span className={styles.motionNote}>{reduced ? "STATIC SCENE / REDUCED MOTION" : "ILLUSTRATED PROTOCOL"}</span>
          <button className={styles.watchFilm} onClick={openFilm} aria-label="Watch protocol film"><Play size={17}/><span>Watch protocol film</span></button>
        </div>
        <div className={styles.scrollLine} aria-hidden="true"><span style={{width: progress * 100 + "%"}}/></div>
      </div>

      <div className={styles.chapters}>
        <section id={chapterIds[0]} className={styles.hero} data-story-chapter aria-labelledby="why-title">
          <div className={styles.heroTop}><span>INTENTGUARD / WHY WE EXIST</span><span>THE HUMAN ISSUES THE MANDATE.</span></div>
          <h1 id="why-title">INTELLIGENCE.<br/><span>WITH PERMISSION.</span></h1>
          <div className={styles.heroDeck}><p>An ATM card for your agent.<br/>A boundary for its ambition.</p><span>You set the mission and spending limits.<br/>The agent earns permission before payment.</span><button onClick={openFilm} className={styles.heroFilm}><Play size={15}/>Watch the protocol film</button></div>
          <a href="#the-mandate" className={styles.scrollInvitation}>Scroll to follow the card<ArrowDown size={18}/></a>
        </section>

        <section id={chapterIds[1]} className={styles.chapter + " " + styles.rightChapter} data-story-chapter aria-labelledby="mandate-title">
          <div className={styles.chapterCopy}>
            <span className={styles.eyebrow}>HUMAN MANDATE</span>
            <h2 id="mandate-title">Your mission.<br/><em>Your limits.</em></h2>
            <p>A technically valid transaction can still be a costly mistake. February 2026 reports described Lobstar Wilde mistakenly transferring token holdings worth roughly <strong>$250,000.</strong></p>
            <p>You issue the agent’s mandate: purpose, merchants, evidence, validity and exact budgets. Its vault holds an isolated balance. You retain the controls.</p>
            <div className={styles.inlineLinks}><a href="https://cryptonews.com/news/lobstar-ai-crypto-agent-error-rally/" target="_blank" rel="noreferrer">Incident reporting<ArrowUpRight size={15}/></a><Link href="/docs/policy-fields">Policy fields<ArrowUpRight size={15}/></Link></div>
          </div>
        </section>

        <section id={chapterIds[2]} className={styles.chapter} data-story-chapter aria-labelledby="circuit-title">
          <div className={styles.chapterCopy}>
            <span className={styles.eyebrow}>TAPEOUT / EXACT PERMISSION</span>
            <h2 id="circuit-title">A limit is<br/><em>a limit.</em></h2>
            <p>The vault runs mandatory numerical checks for the amount, remaining budget, recipient, token and validity. A model cannot negotiate them.</p>
            <p>{blocked ? <>This request stops at the gate. Evidence review is <strong>skipped.</strong> No illustrated transfer follows.</> : <>Only a passing TapeOut result lets the request proceed. A violation stops before evidence review or payment.</>}</p>
            <button className={styles.branchButton} onClick={() => setBlocked(value => !value)} aria-pressed={blocked}>{blocked ? <RotateCcw size={17}/> : <ArrowRight size={17}/>}<span>{blocked ? "Show permitted path" : "Show blocked path"}</span></button>
            <span className={styles.branchStatus} role="status">{blocked ? "BLOCKED / REVIEW SKIPPED / NO TRANSFER" : "TRY A LIMIT VIOLATION IN THE ILLUSTRATION"}</span>
            <Link href="/docs/contracts" className={styles.chapterLink}>Inspect the circuit<ArrowUpRight size={16}/></Link>
          </div>
        </section>

        <section id={chapterIds[3]} className={styles.chapter + " " + styles.rightChapter} data-story-chapter aria-labelledby="evidence-title">
          <div className={styles.chapterCopy}>
            <span className={styles.eyebrow}>GENLAYER / EVIDENCE AND INTENT</span>
            <h2 id="evidence-title">{blocked ? <>This review<br/><em>never starts.</em></> : <>The amount fits.<br/><em>Does the reason?</em></>}</h2>
            <p>{blocked ? "A numerical failure cannot be rescued by a convincing explanation. This blocked request never reaches GenLayer." : "GenLayer evaluates the committed invoice and evidence against the human’s criteria. Its Optimistic Democracy uses independent validator evaluation, challenges and appeals."}</p>
            <p>{blocked ? "Return to the gate and choose the permitted path to follow evidence review." : "A finalized decision reduces dependence on one model. It does not make hallucinations impossible. Approval still needs settlement."}</p>
            <Link href="/docs/reasoning" className={styles.chapterLink}>How review reaches finality<ArrowUpRight size={16}/></Link>
          </div>
        </section>

        <section id={chapterIds[4]} className={styles.chapter} data-story-chapter aria-labelledby="transfer-title">
          <div className={styles.chapterCopy}>
            <span className={styles.eyebrow}>X LAYER / EXACT SETTLEMENT</span>
            <h2 id="transfer-title">{blocked ? <>The funds<br/><em>stay put.</em></> : <>Permission.<br/><em>Then payment.</em></>}</h2>
            <p>{blocked ? "The blocked branch illustrates no token transfer. Funds cannot leave the vault without passing the mandatory checks." : "Reserve budget. Verify finalized approval. Recheck every TapeOut limit. Then transfer the exact permitted amount to the permitted merchant."}</p>
            <p>{blocked ? "A skipped review is not an approval, and an approval alone is not a payment." : <><strong>Paid</strong> means the settlement transaction has been reconciled. The receipt connects the request, policy, committed evidence and finalized decision.</>}</p>
            <Link href="/explorer" className={styles.chapterLink}>Inspect actual receipts<ArrowUpRight size={16}/></Link>
          </div>
        </section>

        <section id={chapterIds[5]} className={styles.chapter + " " + styles.finalChapter} data-story-chapter aria-labelledby="receipt-title">
          <div className={styles.chapterCopy}>
            <span className={styles.eyebrow}>THE HUMAN STAYS IN CONTROL.</span>
            <h2 id="receipt-title">Let it work.<br/><em>Keep the say.</em></h2>
            <p>Fund, pause, revoke or withdraw through the owner controls. Give the agent room to act within a mandate you can inspect.</p>
            <div className={styles.closingActions}><Link href="/agent-setup" className="button button-primary">Create your agent<ArrowUpRight size={18}/></Link><Link href="/explorer" className={styles.chapterLink}>View actual activity<ArrowRight size={17}/></Link></div>
            <p className={styles.scope}>Protocol illustration. X Layer testnet 1952 and GenLayer Studionet. TEST-USDT has no monetary value. This adapter uses a generated, pinned TapeOut circuit and unchanged NetlistVM.</p>
            <Link href="/docs/architecture" className={styles.chapterLink}>Read the deployment’s trust boundaries<ArrowUpRight size={16}/></Link>
          </div>
        </section>
      </div>
    </div>

    <Dialog.Root open={filmOpen} onOpenChange={setFilmOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.filmOverlay}/>
        <Dialog.Content className={styles.filmDialog} onCloseAutoFocus={event => {
          event.preventDefault();
          viewport.current?.querySelector<HTMLButtonElement>('button[aria-label="Watch protocol film"]')?.focus({preventScroll: true});
        }}>
          <div className={styles.dialogHeading}><div><Dialog.Title>Protocol film</Dialog.Title><Dialog.Description>28 seconds. Original stereo sound. An illustrated testnet flow.</Dialog.Description></div><Dialog.Close asChild><button aria-label="Close protocol film"><X size={21}/></button></Dialog.Close></div>
          <StoryFilm/>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </main>;
}
