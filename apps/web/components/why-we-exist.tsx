"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {ArrowDown,ArrowRight,ArrowUpRight,Check,ChevronRight,Pause,Play,RotateCcw,Volume2,VolumeX} from "lucide-react";
import {BrandMark,CardChip} from "./brand";
import styles from "./why-we-exist.module.css";

const chapters=[
  {id:"the-instruction",label:"Instruction",state:"AN INSTRUCTION IS NOT PERMISSION"},
  {id:"the-mandate",label:"Human mandate",state:"THE HUMAN SETS THE BOUNDARY"},
  {id:"the-circuit",label:"TapeOut gate",state:"EXACT RULES BEFORE EVIDENCE"},
  {id:"the-evidence",label:"GenLayer review",state:"COMMITTED EVIDENCE. FINALIZED DECISION."},
  {id:"the-transfer",label:"X Layer transfer",state:"RESERVE. RECHECK. SETTLE."}
] as const;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));
const cues=[
  {from:0,text:"An agent prepares a purchasing request against the human mandate."},
  {from:4.7,text:"The human-issued ATM card enters the permission reader."},
  {from:8.3,text:"An over-limit request is blocked. GenLayer review is skipped."},
  {from:12,text:"A new permitted request passes TapeOut and reserves its budget."},
  {from:15.7,text:"GenLayer reviews committed evidence with independent validator evaluation."},
  {from:20.3,text:"The X Layer vault rechecks permission before exact settlement."},
  {from:24,text:"The merchant receives tokens. The receipt connects intent, review and payment."}
];
function StoryFilm({cover}:{cover:ReactNode}){
  const film=useRef<HTMLVideoElement>(null),frame=useRef<HTMLDivElement>(null),desired=useRef(false),visible=useRef(true),started=useRef(false),playAttempt=useRef(0);
  const [reduced,setReduced]=useState(true),[ready,setReady]=useState(false),[playing,setPlaying]=useState(false),[muted,setMuted]=useState(true),[volume,setVolume]=useState(.65),[error,setError]=useState(false),[slow,setSlow]=useState(false),[ended,setEnded]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0);
  const sync=useCallback(()=>{
    const v=film.current;if(!v)return;const attempt=++playAttempt.current;
    if(desired.current&&visible.current&&!document.hidden&&!v.error){void v.play().catch(()=>{if(attempt!==playAttempt.current||!desired.current||!visible.current||document.hidden)return;setPlaying(false);desired.current=false})}
    else v.pause();
  },[]);
  useEffect(()=>{
    const v=film.current;if(!v)return;const source=v.querySelector("source");
    const observe=()=>{setDuration(Number.isFinite(v.duration)?v.duration:0);setTime(v.currentTime);setPlaying(!v.paused&&!v.ended);setEnded(v.ended);if(v.readyState>=2&&!v.error){setReady(true);setError(false);setSlow(false)}};
    const failed=()=>{++playAttempt.current;desired.current=false;setError(true);setPlaying(false)};
    const finished=()=>{desired.current=false;setPlaying(false);setEnded(true)};
    const events=["loadedmetadata","loadeddata","canplay","play","pause","timeupdate"];
    for(const event of events)v.addEventListener(event,observe);
    v.addEventListener("error",failed);source?.addEventListener("error",failed);v.addEventListener("ended",finished);
    // Media can load or fail before hydration; reconcile its existing browser state.
    if(v.error||v.networkState===HTMLMediaElement.NETWORK_NO_SOURCE)failed();else observe();
    return()=>{for(const event of events)v.removeEventListener(event,observe);v.removeEventListener("error",failed);source?.removeEventListener("error",failed);v.removeEventListener("ended",finished)};
  },[]);
  useEffect(()=>{
    const query=matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>{setReduced(query.matches);if(query.matches){desired.current=false;film.current?.pause()}else if(!started.current){started.current=true;desired.current=true;sync()}};
    update();query.addEventListener("change",update);
    const video=film.current;const onVisibility=()=>sync();document.addEventListener("visibilitychange",onVisibility);
    const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting;sync()},{threshold:.12});
    if(frame.current)observer.observe(frame.current);
    try{const saved=Number(localStorage.getItem("intentguard-story-volume"));if(localStorage.getItem("intentguard-story-volume")!==null&&Number.isFinite(saved))setVolume(clamp(saved))}catch{}
    return()=>{query.removeEventListener("change",update);document.removeEventListener("visibilitychange",onVisibility);observer.disconnect();desired.current=false;started.current=false;video?.pause()};
  },[sync]);
  useEffect(()=>{const v=film.current;if(v){v.muted=muted;v.volume=volume}},[muted,volume]);
  useEffect(()=>{if(ready||error)return;const t=setTimeout(()=>setSlow(true),10000);return()=>clearTimeout(t)},[ready,error]);
  function play(withSound=false){const v=film.current;if(!v)return;if(ended){v.currentTime=0;setEnded(false)}if(withSound){v.muted=false;setMuted(false);if(volume===0){v.volume=.65;setVolume(.65)}}desired.current=true;sync()}
  function toggle(){if(playing){desired.current=false;film.current?.pause()}else play()}
  function sound(){if(muted)play(true);else{if(film.current)film.current.muted=true;setMuted(true)}}
  function replay(){const v=film.current;if(!v)return;v.currentTime=0;setTime(0);setEnded(false);play()}
  function retry(){setError(false);setReady(false);setSlow(false);setEnded(false);desired.current=!reduced;film.current?.load();sync()}
  const cue=(cues.filter(cue=>time>=cue.from).at(-1)||cues[0]).text;
  return <div ref={frame} className={styles.film} data-story-film data-film-state={error?"error":ended?"ended":playing?"playing":ready?"paused":"loading"}>
    <div className={styles.filmScreen}>
      {/* The poster stays behind the video, including during initial decoding and network failure. */}
      <img src="/motion/protocol-story-poster.jpg" alt="An IntentGuard terminal agent presents its engraved ATM card to a mechanical payment gate." width="1920" height="1080" className={styles.poster}/>
      <video ref={film} className={ready&&!error?styles.video:styles.videoWaiting} poster="/motion/protocol-story-poster.jpg" preload="auto" playsInline muted aria-label="IntentGuard protocol story film">
        <source src="/motion/protocol-story.mp4" type="video/mp4"/>
      </video>
      <div className={styles.cover}>{cover}</div>
      <div className={styles.filmLabel}><span>INTENTGUARD / PROTOCOL FILM</span><span>ILLUSTRATIVE FLOW · TESTNET</span></div>
      {!error&&(muted||!playing||reduced)&&<div className={styles.filmInvitation}><button onClick={()=>play(true)} className={styles.soundPlay}><Play size={20} fill="currentColor"/>{ended?"Replay story with sound":"Play story with sound"}</button><span>Sound starts only when you choose it.</span></div>}
      {!ready&&!error&&<div className={styles.loadingNote} role="status"><span className={styles.loadingDot}/>{slow?"The film is taking longer to load. The complete story continues below.":"Preparing the protocol film…"}</div>}
      {error&&<div className={styles.filmError} role="alert"><p>The film could not load. You can still follow the full journey below.</p><button onClick={retry}>Retry film<RotateCcw size={16}/></button></div>}
      <div className={styles.filmProgress} aria-hidden="true"><span style={{width:duration?clamp(time/duration)*100+"%":"0%"}}/></div>
    </div>
    <div className={styles.filmControls} aria-label="Story film controls">
      <div className={styles.playbackButtons}>
        <button onClick={toggle} aria-label={playing?"Pause film":"Play film"} disabled={error}>{playing?<Pause size={17}/>:<Play size={17}/>}<span>{playing?"Pause":"Play"}</span></button>
        <button onClick={sound} aria-label={muted?"Turn sound on":"Mute sound"} aria-pressed={!muted}>{muted?<VolumeX size={18}/>:<Volume2 size={18}/>}<span>{muted?"Muted":"Sound on"}</span></button>
        <label className={styles.volume}><span>Volume</span><input type="range" min="0" max="100" step="1" value={Math.round(volume*100)} aria-label="Film volume" aria-valuetext={Math.round(volume*100)+" percent"} onChange={event=>{const value=Number(event.target.value)/100;setVolume(value);try{localStorage.setItem("intentguard-story-volume",String(value))}catch{}}}/></label>
        <button onClick={replay} aria-label="Replay film" disabled={error}><RotateCcw size={16}/><span>Replay</span></button>
      </div>
      <span className={styles.filmCaption}>{cue}</span>
    </div>
    <details className={styles.transcript}><summary>Film description and sound</summary><p>The film first shows an agent forming a purchasing request and presenting its human-issued card. An over-limit request fails the TapeOut gate: GenLayer review is skipped and no transfer occurs. A new permitted request then passes the circuit and reserves budget. GenLayer checks committed evidence with independent validator evaluation. The X Layer vault rechecks the exact limits before settlement, then the merchant receives tokens and a receipt. Card contact, mechanical gates, computation and confirmation have original synchronized sound. This is a protocol illustration; no depicted transfer represents live activity. The same stages are explained in text below.</p></details>
  </div>;
}
function MiniAgent(){return <svg viewBox="0 0 120 160" fill="none" className={styles.miniAgent} aria-hidden="true"><path d="M28 36V17h64v19M34 17V9h52v8" stroke="currentColor" strokeWidth="3"/><rect x="16" y="34" width="88" height="98" rx="16" fill="#26332f" stroke="#98a89c" strokeWidth="2"/><rect x="27" y="50" width="66" height="31" rx="9" fill="#101716" stroke="#526359"/><rect x="40" y="61" width="9" height="8" rx="2" fill="#edf2ec"/><rect x="71" y="61" width="9" height="8" rx="2" fill="#edf2ec"/><path d="M31 100h58m-58 5h58M6 58v42m108-42v42M30 132v15h17v-15m26 0v15h17v-15" stroke="#b5d7ae" strokeWidth="3"/><path d="M40 113h40" stroke="#526359" strokeWidth="2"/></svg>}
function MandateCard({small=false}:{small?:boolean}){return <div className={small?styles.mandateCardSmall:styles.mandateCard}><div className={styles.cardTop}><span><BrandMark size={22}/>IntentGuard</span><span>ATM / MANDATE</span></div><div className={styles.cardContact}><CardChip/><span>HUMAN-ISSUED<br/>SPENDING PERMISSION</span></div><div className={styles.cardRules}><span>AMOUNT</span><span>RECIPIENT</span><span>PURPOSE</span></div><div className={styles.cardBottom}>BOUND BY POLICY<span>ON X LAYER TESTNET</span></div></div>}
function MechanicalStage({active,blocked}:{active:number;blocked:boolean}){
  const atCircuit=active===2,afterCircuit=active>=3;
  const state=atCircuit&&blocked?"BLOCKED BRANCH / EVIDENCE REVIEW SKIPPED":chapters[active].state;
  return <div className={styles.stage} data-story-stage data-stage={active} data-blocked={blocked&&atCircuit?"true":"false"}>
    <div className={styles.stageHeading}><BrandMark size={24}/><span>THE PERMISSION MACHINE</span><span className={styles.stageIndex}>{"0"+(active+1)} / 05</span></div>
    <div className={styles.stageViewport} data-story-viewport>
      <svg viewBox="0 0 700 680" className={styles.machine} aria-hidden="true">
        <defs><pattern id="story-machine-grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#526359" strokeWidth=".6"/></pattern></defs>
        <rect x="12" y="12" width="676" height="638" fill="url(#story-machine-grid)" opacity=".18"/>
        <path d="M70 167H350V277H350V420H575V558" className={styles.trackBase}/>
        <path d="M70 167H350V277H350V420H575V558" className={styles.trackProgress} pathLength="1"/>
        <path d="M350 278H580V327" className={styles.blockedTrack}/>
        <path d="M350 270h-16m16 8h-16M350 420h-16m16 8h-16M575 557h-16" stroke="#b5d7ae" strokeWidth="3"/>
        <g className={styles.svgAgent}><path d="M49 77V59h67v18" fill="none" stroke="#98a89c" strokeWidth="2"/><rect x="38" y="75" width="90" height="105" rx="14" fill="#26332f" stroke="#98a89c" strokeWidth="2"/><rect x="48" y="93" width="70" height="30" rx="7" fill="#101716"/><rect x="61" y="105" width="8" height="7" rx="2" fill="#edf2ec"/><rect x="94" y="105" width="8" height="7" rx="2" fill="#edf2ec"/><path d="M56 147h54m-54 5h54M48 180v14m68-14v14" stroke="#b5d7ae" strokeWidth="3"/><text x="36" y="222" className={styles.svgLabel}>AGENT</text><text x="36" y="242" className={styles.svgCaption}>PRESENTS THE REQUEST</text></g>
        <g className={styles.ownerSeal}><circle cx="274" cy="112" r="42" fill="#192321" stroke="#526359"/><path d="M253 96h12v14h-12v-14Zm26 24h12v14h-12v-14Zm-26 0h12v14h-12v-14Zm26-24h12v14h-12V96Z" fill="#b5d7ae"/><path d="M247 115h51" stroke="#b5d7ae" strokeWidth="3"/><text x="325" y="102" className={styles.svgLabel}>HUMAN MANDATE</text><text x="325" y="124" className={styles.svgCaption}>EXACT. IMMUTABLE. OWNER-ISSUED.</text></g>
        <g className={styles.circuitGate}><rect x="218" y="253" width="266" height="83" rx="4" fill="#192321" stroke="#98a89c" strokeWidth="1.5"/><path d="M235 268v54m8-54v54M458 268v54m8-54v54" stroke="#526359" strokeWidth="2"/><path d="M328 260v69m44-69v69" className={styles.gateBars}/><text x="259" y="280" className={styles.svgLabel}>TAPEOUT</text><text x="259" y="303" className={styles.svgCaption}>NUMERICAL PERMISSION</text><text x="218" y="358" className={styles.svgCaption}>AMOUNT / RECIPIENT / ASSET / TIME</text></g>
        <g className={styles.skipStamp}><rect x="505" y="318" width="174" height="57" rx="4" fill="#101716" stroke="#f4a8a3"/><text x="520" y="341" className={styles.svgDanger}>BLOCKED</text><text x="520" y="361" className={styles.svgCaption}>REVIEW SKIPPED</text></g>
        <g className={styles.reviewGate}><rect x="214" y="393" width="270" height="82" rx="4" fill="#192321" stroke={afterCircuit?"#b5d7ae":"#526359"} strokeWidth="1.5"/><text x="234" y="422" className={styles.svgLabel}>GENLAYER</text><text x="234" y="448" className={styles.svgCaption}>EVIDENCE + PURPOSE</text><path d="M435 404v59m10-59v59m10-59v59" stroke="#526359" strokeWidth="2"/><path d="M332 400v68m42-68v68" className={styles.reviewBars}/></g>
        <g className={styles.evidenceSheets}><rect x="54" y="388" width="112" height="94" rx="3" transform="rotate(-7 54 388)" fill="#26332f" stroke="#526359"/><rect x="60" y="379" width="112" height="94" rx="3" fill="#192321" stroke="#98a89c"/><path d="M76 399h68m-68 12h79m-79 12h53m-53 26h61" stroke="#b2beb5" strokeWidth="2"/><text x="48" y="510" className={styles.svgCaption}>COMMITTED EVIDENCE</text><path d="M177 428h24m-6-5 6 5-6 5" stroke="#b5d7ae" strokeWidth="2"/></g>
        <g className={styles.merchant}><path d="M514 543h127l-12-30h-102l-13 30Z" fill="#26332f" stroke="#98a89c" strokeWidth="2"/><rect x="521" y="544" width="113" height="56" fill="#192321" stroke="#98a89c" strokeWidth="2"/><path d="M543 544v56m68-56v56" stroke="#526359"/><rect x="557" y="562" width="40" height="24" fill="#101716" stroke="#526359"/><text x="504" y="626" className={styles.svgLabel}>MERCHANT</text></g>
        <g className={styles.receipt}><rect x="273" y="527" width="173" height="92" rx="4" fill="#26332f" stroke="#b5d7ae"/><text x="291" y="552" className={styles.svgLabel}>EXACT TRANSFER</text><path d="M290 564h136m-136 16h89m-89 13h110" stroke="#98a89c" strokeWidth="2"/><path d="M479 567h-23m7-5-7 5 7 5" stroke="#b5d7ae" strokeWidth="2"/></g>
      </svg>
      <div className={styles.travellingCard}><MandateCard small/></div>
    </div>
    <div className={styles.stageStatus}><span className={styles.statusLight}/><span>{state}</span></div>
    <p className={styles.stageDisclaimer}>Illustrative protocol flow. Financial states here describe the checks, not a live request.</p>
  </div>;
}
function StoryJourney(){
 const journey=useRef<HTMLDivElement>(null),stageWrap=useRef<HTMLDivElement>(null),[active,setActive]=useState(0),[blocked,setBlocked]=useState(false),[reduced,setReduced]=useState(true),lastActive=useRef(0);
 useEffect(()=>{
  const query=matchMedia("(prefers-reduced-motion: reduce)");let tick=0;
  const update=()=>{
    tick=0;const root=journey.current,stage=stageWrap.current;if(!root||!stage)return;
    const sections=Array.from(root.querySelectorAll<HTMLElement>("[data-story-chapter]"));
    let current=0;for(let i=0;i<sections.length;i++)if(sections[i].getBoundingClientRect().top<=innerHeight*.6)current=i;
    for(const section of sections){const position=section.getBoundingClientRect();section.style.setProperty("--section-progress",clamp((innerHeight*.6-position.top)/Math.max(position.height,1)).toFixed(4))}
    const rect=sections[current]?.getBoundingClientRect();const local=rect?clamp((innerHeight*.6-rect.top)/Math.max(rect.height,1)):0;
    const progress=clamp((current+local)/chapters.length);
    root.dataset.progress=progress.toFixed(3);root.dataset.active=String(current);
    stage.style.setProperty("--story-progress",progress.toFixed(4));
    stage.style.setProperty("--chapter-progress",local.toFixed(4));
    stage.style.setProperty("--machine-turn",query.matches?"0deg":((Math.sin(progress*Math.PI*2))*2.5).toFixed(3)+"deg");
    // Coordinates follow the drawn request path in viewBox space. Each gate is a distinct mechanical stop.
    const points=[[90,167],[350,167],[350,292],[350,431],[575,558],[575,558]];
    const a=points[current],b=points[current+1];const eased=local*local*(3-2*local);
    stage.style.setProperty("--card-x",((a[0]+(b[0]-a[0])*eased)/700*100).toFixed(3)+"%");
    stage.style.setProperty("--card-y",((a[1]+(b[1]-a[1])*eased)/680*100).toFixed(3)+"%");
    if(lastActive.current!==current){lastActive.current=current;setActive(current)}
  };
  const schedule=()=>{if(!tick)tick=requestAnimationFrame(update)};
  const change=()=>{setReduced(query.matches);schedule()};
  change();query.addEventListener("change",change);addEventListener("scroll",schedule,{passive:true});addEventListener("resize",schedule,{passive:true});schedule();
  return()=>{query.removeEventListener("change",change);removeEventListener("scroll",schedule);removeEventListener("resize",schedule);cancelAnimationFrame(tick)};
 },[]);
 return <div ref={journey} className={styles.journey} data-story-journey data-reduced-motion={reduced?"true":"false"}>
   <div className={styles.journeyBar}><span>FOLLOW A REQUEST</span><nav aria-label="Protocol story chapters">{chapters.map((c,i)=><a key={c.id} href={"#"+c.id} aria-current={active===i?"step":undefined}><span>{"0"+(i+1)}</span>{c.label}</a>)}</nav><ArrowDown size={18}/></div>
   <div className={styles.journeyGrid}>
     <div ref={stageWrap} className={styles.stickyStage}><MechanicalStage active={active} blocked={blocked}/></div>
     <div className={styles.chapters}>
       <section id="the-instruction" className={styles.instructionChapter} data-story-chapter aria-labelledby="instruction-title">
         <div className={styles.chapterLabel}>THE FIRST DISTANCE / THINKING TO SPENDING</div><h2 id="instruction-title">An agent can act.<br/><em>Should it?</em></h2><p>Agents can buy data, tools and services. Their wallets can send valid transactions. Neither ability proves that a purchase serves the human who funded it.</p><div className={styles.instructionWords}><span>THE REQUEST</span><strong>amount<br/>recipient<br/>purpose<br/>evidence</strong><span>ALL FOUR MUST AGREE WITH THE MANDATE.</span></div><p>IntentGuard places a separate permission machine between the agent’s request and your funds.</p>
       </section>
       <section id="the-mandate" className={styles.mandateChapter} data-story-chapter aria-labelledby="mandate-title">
         <div className={styles.chapterLabel}>HUMAN CONTROL / WRITTEN BEFORE ACTION</div><h2 id="mandate-title">Give the agent<br/>a mission.<br/><em>Issue its limits.</em></h2><p>You define the name, mission, permitted merchants, evidence criteria, validity window and exact budgets. Approving the policy creates an immutable spending mandate.</p><div className={styles.mandateDisplay}><MandateCard/><div className={styles.mandateBinding}><span>POLICY COMMITMENT</span><div/><span>AGENT VAULT</span></div></div><p>The card identifies the agent’s permission. Its vault holds an isolated balance. The human can fund, pause, revoke or withdraw through the owner controls.</p><Link href="/docs/policy-fields" className={styles.chapterLink}>Read every policy field<ArrowUpRight size={16}/></Link>
       </section>
       <section id="the-circuit" className={styles.circuitChapter} data-story-chapter aria-labelledby="circuit-title">
         <div className={styles.chapterLabel}>TAPEOUT / MANDATORY NUMERICAL GATE</div><h2 id="circuit-title">A model cannot<br/><em>negotiate a limit.</em></h2><p>The agent vault executes a generated, pinned TapeOut NAND circuit through the unchanged NetlistVM on X Layer testnet.</p><div className={styles.ruleBoard}><div><span>PAYMENT</span><code>amount ≤ per-payment limit</code></div><div><span>BUDGET</span><code>spent + reserved + amount ≤ limit</code></div><div><span>DESTINATION</span><code>recipient + token are permitted</code></div><div><span>VALIDITY</span><code>card enabled + time allowed</code></div><div className={styles.ruleOutput}><span>ALL CHECKS MUST PASS</span><Check size={21}/></div></div><p>Without a passing TapeOut result, the vault cannot settle a request. A violation stops before GenLayer. Evidence review is <strong>skipped</strong>; the merchant receives no transfer.</p><button className={styles.branchButton} onClick={()=>setBlocked(v=>!v)} aria-pressed={blocked}>{blocked?"Show permitted path":"Show blocked path"}<ChevronRight size={18}/></button><span className={styles.branchHint}>Interactive protocol illustration. No request is submitted.</span><Link href="/docs/contracts" className={styles.chapterLink}>Inspect the circuit and contracts<ArrowUpRight size={16}/></Link>
       </section>
       <section id="the-evidence" className={styles.evidenceChapter} data-story-chapter aria-labelledby="evidence-title">
         <div className={styles.chapterLabel}>GENLAYER / EVIDENCE AGAINST INTENT</div><h2 id="evidence-title">The amount fits.<br/><em>Does the reason?</em></h2><p>Only after numerical permission passes does the intelligent contract evaluate the committed merchant invoice and evidence against the human’s criteria. Each required criterion must pass.</p><div className={styles.evidenceAssembly}><div className={styles.evidenceSlip}><span>COMMITTED INPUTS</span><strong>Invoice.<br/>Evidence.<br/>Human mandate.</strong><div className={styles.paperLines}/><span>HASH-BOUND TO THIS REQUEST</span></div><div className={styles.verdictSlip}><BrandMark size={25}/><span>INDEPENDENT VALIDATION</span><strong>Review.<br/>Challenge.<br/>Finalize.</strong></div></div><p>GenLayer’s Optimistic Democracy brings independent validator evaluation, majority agreement, challenges and appeals. It reduces dependence on one model; it does not guarantee that hallucinations are impossible.</p><p>Approval, rejection and requests for more evidence are different outcomes. The UI reveals contract reasoning only after a successful finalized result has been verified.</p><Link href="/docs/reasoning" className={styles.chapterLink}>Follow the finality and reasoning model<ArrowUpRight size={16}/></Link>
       </section>
       <section id="the-transfer" className={styles.transferChapter} data-story-chapter aria-labelledby="transfer-title">
         <div className={styles.chapterLabel}>X LAYER / PERMISSION BECOMES SETTLEMENT</div><h2 id="transfer-title">Exact funds.<br/>Exact recipient.<br/><em>One receipt.</em></h2><div className={styles.transferSequence}><span>RESERVE</span><ArrowRight size={20}/><span>RECHECK</span><ArrowRight size={20}/><span>TRANSFER</span></div><p>Reservation protects budget while evidence is reviewed. The worker verifies finalized approval, then the X Layer vault runs the TapeOut checks again before transferring the permitted token amount to the permitted merchant.</p><p>A review approval alone is not payment. <strong>Paid</strong> means the settlement transaction has been reconciled. The receipt links the request, policy, evidence, finalized GenLayer result and X Layer transfer.</p><p>GitHub Actions resumes queued work and reconciles submitted transactions. Recoverable waits are retried. Terminal blocked, rejected and expired requests release reservations instead of leaving a review spinning.</p><Link href="/explorer" className={styles.chapterLink}>Inspect actual receipts<ArrowUpRight size={16}/></Link><span className={styles.testnetNote}>X Layer testnet 1952 · GenLayer Studionet 61999<br/>TEST-USDT has no monetary value.</span>
       </section>
     </div>
   </div>
 </div>;
}
export function WhyWeExist(){return <main id="main" className={styles.storyPage}>
  <section className={styles.hero} aria-labelledby="why-title"><StoryFilm cover={<><div className={styles.heroTop}><span>INTENTGUARD / THE REASON WE BUILT</span><span>OWNER PERMISSION BEFORE PAYMENT</span></div><h1 id="why-title">WHY WE <span>EXIST.</span></h1><div className={styles.heroDeck}><h2>Intelligence can move money.<br/>Permission should move first.</h2><p>Watch an agent bring its card, prove its purpose and earn a payment. Then scroll through the machine that makes it possible.</p></div></>}/><a href="#the-cost" className={styles.scrollInvitation}>Scroll into the story<ArrowDown size={18}/></a></section>
  <section id="the-cost" className={styles.incident} aria-labelledby="cost-title"><div className={styles.incidentRail}><span>THE COST OF AN UNGUARDED INSTRUCTION</span><MiniAgent/></div><div className={styles.incidentStatement}><h2 id="cost-title">The instruction<br/>was small.<br/>The mistake<br/><em>wasn’t.</em></h2></div><div className={styles.incidentAccount}><span className={styles.incidentAmount}>$250,000</span><span className={styles.incidentQualifier}>REPORTED VALUE OF MISTAKENLY TRANSFERRED HOLDINGS</span><p>Reports in February 2026 described Lobstar Wilde accidentally transferring its LOBSTAR token holdings, valued at roughly $250,000, to a reply.</p><p>A transaction can be technically valid and still violate the human’s intent. A spending agent needs a boundary outside its own reasoning.</p><a href="https://cryptonews.com/news/lobstar-ai-crypto-agent-error-rally/" target="_blank" rel="noreferrer" className={styles.chapterLink}>Read the incident reporting<ArrowUpRight size={16}/></a><p className={styles.sourceNote}>Reported incident, not an IntentGuard transaction. The story below illustrates this protocol’s purchasing controls on testnet.</p></div></section>
  <StoryJourney/>
  <section className={styles.closing} aria-labelledby="closing-title"><div className={styles.closingIdentity}><MiniAgent/><BrandMark size={80}/></div><div className={styles.closingCopy}><span>LET THE AGENT WORK. KEEP THE HUMAN IN CONTROL.</span><h2 id="closing-title">Ambition, issued.<br/><em>Permission, earned.</em></h2><p>Auditable agent purchasing. Isolated budgets. Evidence you can inspect. Workflows that recover. Human controls that remain available after issuance.</p><div className={styles.closingActions}><Link href="/agent-setup" className="button button-primary">Create your agent<ArrowUpRight size={18}/></Link><Link href="/explorer" className={styles.chapterLink}>View actual activity<ArrowRight size={18}/></Link></div><p className={styles.closingScope}>Built with TapeOut circuits on X Layer testnet and GenLayer Studionet. This deployment uses a generated pinned circuit and unchanged NetlistVM. It does not claim the official mainnet CPU registry or X Layer DeWEB deployment.</p></div></section>
</main>}
