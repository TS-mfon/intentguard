import {AbsoluteFill, Composition, delayRender, continueRender, useCurrentFrame, useVideoConfig, staticFile} from "remotion";
import {useEffect, useState} from "react";

export const FRAME_COUNT = 300;
export const WIDTH = 1280;
export const HEIGHT = 720;
export const FPS = 30;

/** A single periodic shot. No identity, balance, or transaction is fabricated. */
export function AgentCardFilm() {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const phase = frame / durationInFrames * Math.PI * 2;
  const [fontHandle] = useState(() => delayRender("Local IBM Plex fonts"));
  useEffect(() => {
    const sans = new FontFace("Plex", "url(" + staticFile("fonts/plex-sans.woff2") + ")", {weight:"500"});
    const mono = new FontFace("Plex Mono", "url(" + staticFile("fonts/plex-mono.woff2") + ")", {weight:"400"});
    Promise.all([sans.load(), mono.load()]).then(fonts => {
      fonts.forEach(font => document.fonts.add(font));
      continueRender(fontHandle);
    }).catch(() => continueRender(fontHandle));
  }, [fontHandle]);
  const breathe = Math.sin(phase);
  const tilt = Math.sin(phase + .5);
  // Raised-cosine blink makes a short, soft eye closure and has periodic ends.
  const blinkAngle = Math.abs(Math.atan2(Math.sin(phase - 2.55), Math.cos(phase - 2.55)));
  const eyeScale = blinkAngle < .16 ? .12 + .88 * Math.sin(blinkAngle / .16 * Math.PI / 2) : 1;
  const sheen = (Math.sin(phase - .4) + 1) * .5;
  return <AbsoluteFill style={{backgroundColor:"#101716", overflow:"hidden"}}>
    <svg width={WIDTH} height={HEIGHT} viewBox="0 0 1280 720" role="img" aria-label="A graphite agent issuing its engraved IntentGuard ATM card" style={{fontFamily:"Plex"}}>
      <defs>
        <radialGradient id="scene-light" cx="65%" cy="40%" r="68%">
          <stop stopColor="#26332f" offset="0"/><stop stopColor="#101716" offset=".85"/>
        </radialGradient>
        <linearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#98a89c"/><stop offset=".12" stopColor="#26332f"/>
          <stop offset=".42" stopColor="#526359"/><stop offset=".78" stopColor="#192321"/>
          <stop offset="1" stopColor="#b2beb5"/>
        </linearGradient>
        <linearGradient id="metal" x1=".15" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#526359"/><stop offset=".28" stopColor="#26332f"/>
          <stop offset=".6" stopColor="#192321"/><stop offset="1" stopColor="#101716"/>
        </linearGradient>
        <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#26332f"/><stop offset=".5" stopColor="#101716"/><stop offset="1" stopColor="#192321"/>
        </linearGradient>
        <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#edf2ec"/><stop offset=".28" stopColor="#b2beb5"/><stop offset=".55" stopColor="#98a89c"/>
          <stop offset=".72" stopColor="#edf2ec"/><stop offset="1" stopColor="#526359"/>
        </linearGradient>
        <linearGradient id="card-face" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#526359"/><stop offset=".14" stopColor="#26332f"/>
          <stop offset=".65" stopColor="#192321"/><stop offset="1" stopColor="#101716"/>
        </linearGradient>
        <linearGradient id="card-gleam" x1="0" y1="0" x2="1" y2=".4">
          <stop offset={Math.max(0,sheen-.22)} stopColor="#edf2ec" stopOpacity="0"/>
          <stop offset={sheen} stopColor="#edf2ec" stopOpacity=".12"/>
          <stop offset={Math.min(1,sheen+.22)} stopColor="#edf2ec" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="chip" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b5d7ae"/><stop offset=".4" stopColor="#98a89c"/><stop offset="1" stopColor="#b5d7ae"/>
        </linearGradient>
        <pattern id="engraving" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
          <path d="M0 0V8" stroke="#edf2ec" strokeOpacity=".025" strokeWidth="1"/>
        </pattern>
        <pattern id="trace" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M0 16H24V48H64 M32 0V8H56V32H64 M0 56H8V64" fill="none" stroke="#b5d7ae" strokeOpacity=".08" strokeWidth="1"/>
        </pattern>
        <filter id="shadow" x="-70%" y="-70%" width="240%" height="260%">
          <feGaussianBlur stdDeviation="16"/>
        </filter>
        <filter id="near-shadow" x="-30%" y="-40%" width="160%" height="200%">
          <feDropShadow dx="0" dy="22" stdDeviation="18" floodColor="#080d0b" floodOpacity=".8"/>
        </filter>
        <clipPath id="card-clip"><rect x="0" y="0" width="596" height="370" rx="20"/></clipPath>
      </defs>
      <rect width="1280" height="720" fill="url(#scene-light)"/>
      {/* A machined gate is the scene structure, not a financial indicator. */}
      <g opacity=".27" fill="none" stroke="#526359">
        <path d="M400 622V198Q400 140 464 140H1114Q1180 140 1180 208V624" strokeWidth="2"/>
        <path d="M426 618V208Q426 166 470 166H1108Q1154 166 1154 208V618"/>
        <path d="M370 628H1220 M382 646H1208"/>
      </g>
      <g stroke="#526359" strokeOpacity=".14" fill="none">
        <path d="M400 648L140 720 M560 648L444 720 M730 648L756 720 M905 648L1060 720 M1080 648L1270 716"/>
        <path d="M245 685H1240"/>
      </g>
      <ellipse cx="814" cy="636" rx={340+breathe*4} ry="28" fill="#080d0b" opacity=".8" filter="url(#shadow)"/>
      <ellipse cx="490" cy="629" rx="124" ry="17" fill="#080d0b" filter="url(#shadow)"/>
      {/* Terminal agent body: clear tactile silhouette, two quiet eyes, no invented user. */}
      <g transform={`translate(334 ${185 + breathe*7}) rotate(${tilt*.65} 170 240)`}>
        <path d="M48 281Q23 290 20 320L4 383Q-2 404 18 413L42 407L73 326Z" fill="url(#bezel)" stroke="#526359" strokeWidth="2"/>
        <path d="M314 281Q345 292 354 316L383 351Q391 367 376 379L354 372L297 323Z" fill="url(#bezel)" stroke="#526359" strokeWidth="2"/>
        <path d="M90 391L82 445Q82 458 95 461H126L139 407Z" fill="url(#metal)" stroke="#526359" strokeWidth="2"/>
        <path d="M210 407L223 461H255Q269 457 263 443L253 390Z" fill="url(#metal)" stroke="#526359" strokeWidth="2"/>
        <path d="M58 453Q83 444 129 452L134 472H62Q45 469 58 453Z" fill="url(#bezel)"/>
        <path d="M220 452Q256 443 276 457L280 472H218Z" fill="url(#bezel)"/>
        <rect x="66" y="227" width="218" height="196" rx="49" fill="url(#bezel)" stroke="#98a89c" strokeWidth="1"/>
        <rect x="71" y="232" width="208" height="183" rx="44" fill="url(#metal)"/>
        <path d="M93 367H258 M101 377H250 M109 387H242" stroke="#526359" strokeWidth="2" opacity=".7"/>
        <rect x="103" y="284" width="145" height="36" rx="9" fill="#101716" stroke="#526359" strokeWidth="2"/>
        <path d="M115 299H234" stroke="#b5d7ae" strokeWidth="3" opacity=".65"/>
        <rect x="40" y="40" width="282" height="222" rx="59" fill="url(#bezel)" stroke="#98a89c" strokeWidth="2"/>
        <rect x="47" y="47" width="268" height="208" rx="52" fill="url(#metal)"/>
        <rect x="66" y="86" width="230" height="121" rx="38" fill="url(#screen)" stroke="#526359" strokeWidth="2"/>
        <path d="M85 99Q160 82 272 102" fill="none" stroke="#edf2ec" strokeOpacity=".08" strokeWidth="6"/>
        <g transform={`translate(0 149) scale(1 ${eyeScale}) translate(0 -149)`}>
          <rect x="109" y="127" width="33" height="38" rx="14" fill="url(#silver)"/>
          <rect x="218" y="127" width="33" height="38" rx="14" fill="url(#silver)"/>
          <rect x="115" y="133" width="8" height="12" rx="4" fill="#edf2ec" opacity=".65"/>
          <rect x="224" y="133" width="8" height="12" rx="4" fill="#edf2ec" opacity=".65"/>
        </g>
        <path d="M158 191H204" stroke="#98a89c" strokeWidth="4" strokeLinecap="round"/>
        {/* Split-slot identity mark echoed on the agent forehead. */}
        <g transform="translate(162 54) scale(.85)" color="#b5d7ae"><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/><path d="M5 20h30" stroke="currentColor" strokeWidth="3"/><path d="M20 8v24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5"/></g>
        <path d="M74 240H285" stroke="#edf2ec" strokeOpacity=".08" strokeWidth="2"/>
        <circle cx="55" cy="145" r="4" fill="#526359"/><circle cx="307" cy="145" r="4" fill="#526359"/>
      </g>
      {/* Issued card, floats toward the viewer. All markings are protocol identity, not sample usage. */}
      <g transform={`translate(${577+Math.cos(phase)*8} ${300+breathe*9}) rotate(${-9+tilt*2.1} 298 185)`} filter="url(#near-shadow)">
        <rect x="-4" y="3" width="606" height="375" rx="22" fill="#526359"/>
        <rect width="596" height="370" rx="20" fill="url(#card-face)" stroke="#98a89c" strokeWidth="1.5"/>
        <g clipPath="url(#card-clip)">
          <rect width="596" height="370" fill="url(#engraving)"/>
          <rect x="297" width="299" height="370" fill="url(#trace)"/>
          <path d="M426 -28L286 388 M466 -28L326 388 M506 -28L366 388 M546 -28L406 388" stroke="#b5d7ae" strokeOpacity=".07" fill="none" strokeWidth="2"/>
          <rect width="596" height="370" fill="url(#card-gleam)"/>
        </g>
        <rect x="12" y="12" width="572" height="346" rx="12" fill="none" stroke="#b2beb5" strokeOpacity=".18"/>
        <g transform="translate(36 27) scale(1.1)" color="#b5d7ae"><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/><path d="M5 20h30" stroke="currentColor" strokeWidth="3"/><path d="M20 8v24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5"/></g>
        <text x="97" y="59" fill="#edf2ec" fontSize="28" fontWeight="500" letterSpacing="-1">IntentGuard</text>
        <text x="550" y="53" fill="#b2beb5" fontFamily="Plex Mono" fontSize="13" letterSpacing="2" textAnchor="end">AGENT ATM</text>
        <g transform="translate(40 111)">
          <rect width="82" height="65" rx="12" fill="url(#chip)" stroke="#b5d7ae" strokeWidth="1"/>
          <path d="M0 20H28V0 M0 43H28V65 M54 0V20H82 M54 65V43H82 M28 20H54V43H28Z M41 20V0 M41 43V65 M0 32H28 M54 32H82" fill="none" stroke="#526359" strokeWidth="1.5"/>
        </g>
        <g transform="translate(145 123)" stroke="#98a89c" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M0 11Q7 20 0 29 M8 5Q21 20 8 36 M17 -1Q36 20 17 43"/>
        </g>
        <text x="40" y="237" fill="#edf2ec" fontSize="38" fontWeight="500" letterSpacing="-1">Permission</text>
        <text x="40" y="280" fill="#edf2ec" fontSize="38" fontWeight="500" letterSpacing="-1">before payment.</text>
        <path d="M40 303H556" stroke="#526359" strokeWidth="1"/>
        <text x="40" y="333" fill="#b2beb5" fontFamily="Plex Mono" fontSize="13" letterSpacing="1.2">YOUR MANDATE. ONCHAIN.</text>
        <text x="553" y="333" textAnchor="end" fill="#b5d7ae" fontFamily="Plex Mono" fontSize="13" letterSpacing="1.5">X LAYER</text>
        {/* Signature gate emboss, large enough to give the card its own identity. */}
        <g transform="translate(400 127) scale(3.15)" color="#526359" opacity=".48"><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/><path d="M5 20h30" stroke="currentColor" strokeWidth="3"/><path d="M20 8v24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5"/></g>
      </g>
      {/* Tiny specular glints belong to the metal, not an ambient effects layer. */}
      <path d={`M${625+Math.cos(phase)*6} ${319+breathe*9}L${873+Math.cos(phase)*6} ${280+breathe*9}`} stroke="#edf2ec" strokeOpacity={.09+sheen*.12} strokeWidth="1.2"/>
    </svg>
  </AbsoluteFill>;
}

export const MyComposition = () => <Composition id="AgentCard" component={AgentCardFilm} durationInFrames={FRAME_COUNT} fps={FPS} width={WIDTH} height={HEIGHT}/>;
