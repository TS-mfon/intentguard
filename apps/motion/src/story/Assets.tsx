import type {ReactNode} from "react";
import {useCurrentFrame, interpolate, Easing} from "remotion";

export const C={bg:"#101716",surface:"#192321",elevated:"#26332f",border:"#526359",text:"#edf2ec",muted:"#b2beb5",accent:"#b5d7ae",danger:"#f4a8a3",warning:"#eed09a"};
export function motion(frame:number,from:number,to:number,start:number,end:number){return interpolate(frame,[from,to],[start,end],{extrapolateLeft:"clamp",extrapolateRight:"clamp",easing:Easing.bezier(.16,1,.3,1)})}
export function Mark({x=0,y=0,size=40,color=C.accent}:{x?:number;y?:number;size?:number;color?:string}){return <g transform={`translate(${x} ${y}) scale(${size/40})`} color={color}><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/><path d="M5 20h30" stroke="currentColor" strokeWidth="3"/><path d="M20 8v24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5"/></g>}
export function Title({title,subtitle}:{title:string;subtitle:string}){return <g><text x="128" y="134" fill={C.text} fontSize="58" fontWeight="500" letterSpacing="-1.2">{title}</text><text x="130" y="183" fill={C.muted} fontSize="28">{subtitle}</text></g>}
export function Stage({children,title,subtitle,camera=1,cameraX=0,cameraY=0}:{children:ReactNode;title:string;subtitle:string;camera?:number;cameraX?:number;cameraY?:number}){
 return <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{fontFamily:"Plex",background:C.bg}}>
 <defs>
  <radialGradient id="sLight" cx="55%" cy="45%" r="75%"><stop stopColor="#2c3b35"/><stop offset=".85" stopColor={C.bg}/></radialGradient>
  <linearGradient id="sMetal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#64796a"/><stop offset=".12" stopColor="#33483d"/><stop offset=".45" stopColor={C.elevated}/><stop offset="1" stopColor={C.bg}/></linearGradient>
  <linearGradient id="sEdge" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b2beb5"/><stop offset=".18" stopColor="#526359"/><stop offset=".55" stopColor="#192321"/><stop offset=".83" stopColor="#98a89c"/><stop offset="1" stopColor="#526359"/></linearGradient>
  <linearGradient id="sGlass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#26332f"/><stop offset=".5" stopColor="#101716"/><stop offset="1" stopColor="#192321"/></linearGradient>
  <linearGradient id="sSilver" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#edf2ec"/><stop offset=".32" stopColor="#b2beb5"/><stop offset=".55" stopColor="#98a89c"/><stop offset=".72" stopColor="#edf2ec"/><stop offset="1" stopColor="#526359"/></linearGradient>
  <linearGradient id="sChip" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d0dfbe"/><stop offset=".35" stopColor="#98a89c"/><stop offset="1" stopColor="#b5d7ae"/></linearGradient>
  <pattern id="sTrace" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M0 20H32V62H80M40 0V10H70V40H80M0 70H10V80" fill="none" stroke="#b5d7ae" strokeOpacity=".1" strokeWidth="1"/></pattern>
  <pattern id="sGrain" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-23)"><path d="M0 0V7" stroke="#edf2ec" strokeOpacity=".025"/></pattern>
  <filter id="sShadow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="sCast" x="-30%" y="-40%" width="160%" height="210%"><feDropShadow dx="0" dy="21" stdDeviation="16" floodColor="#070c09" floodOpacity=".8"/></filter>
 </defs>
 <rect width="1920" height="1080" fill="url(#sLight)"/>
 <g transform={`translate(${cameraX} ${cameraY}) translate(960 540) scale(${camera}) translate(-960 -540)`}>
 <path d="M198 907H1760M218 929H1734" stroke={C.border} strokeOpacity=".24" fill="none"/>
 <path d="M330 922L95 1080M640 922L485 1080M950 922L950 1080M1260 922L1450 1080M1570 922L1840 1080" stroke={C.border} strokeOpacity=".12" fill="none"/>
 {children}
 </g>
 <Title title={title} subtitle={subtitle}/>
 <path d="M128 977H1792" stroke={C.border} strokeOpacity=".55"/>
 <Mark x={130} y={996} size={34}/><text x="181" y="1022" fill={C.muted} fontFamily="Plex Mono" fontSize="20">INTENTGUARD · PROTOCOL ILLUSTRATION</text>
 <text x="1790" y="1022" textAnchor="end" fill={C.muted} fontFamily="Plex Mono" fontSize="20">X LAYER TESTNET · GENLAYER STUDIONET</text>
 </svg>;
}
export function Agent({x=0,y=0,scale=1,reach=0,look=0}:{x?:number;y?:number;scale?:number;reach?:number;look?:number}){
 const frame=useCurrentFrame(),blink=Math.abs((frame%140)-91)<3?.2:1;
 return <g transform={`translate(${x} ${y}) scale(${scale})`}>
 <ellipse cx="175" cy="475" rx="135" ry="19" fill="#070c09" filter="url(#sShadow)"/>
 <path d="M49 279Q25 290 20 319L2 385Q0 408 19 410L42 401L76 322Z" fill="url(#sEdge)" stroke={C.border} strokeWidth="2"/>
 <path d={`M307 279Q334 288 349 319L${383+reach} 330Q${410+reach} 337 ${405+reach} 356L${389+reach} 370L320 338Z`} fill="url(#sMetal)" stroke={C.border} strokeWidth="3"/>
 <g transform={`translate(${384+reach} 342)`} fill="url(#sEdge)" stroke={C.border} strokeWidth="2"><path d="M-4 -13H18Q31 -12 31 -2V11H20V0H4Z"/><path d="M0 15H29V28H-3Z"/></g>
 <path d="M90 391L80 446Q83 459 96 460H127L139 408Z M211 407L223 461H253Q269 457 263 443L252 390Z" fill="url(#sMetal)" stroke={C.border} strokeWidth="2"/>
 <path d="M59 451Q86 443 129 451L134 472H61Q44 469 59 451Z M218 452Q252 444 277 457L280 472H218Z" fill="url(#sEdge)"/>
 <rect x="66" y="226" width="218" height="194" rx="48" fill="url(#sEdge)" stroke="#98a89c"/>
 <rect x="72" y="232" width="206" height="182" rx="42" fill="url(#sMetal)"/>
 <path d="M95 367H255M103 378H248M111 389H240" stroke={C.border} strokeWidth="2"/>
 <rect x="102" y="283" width="146" height="36" rx="9" fill={C.bg} stroke={C.border} strokeWidth="2"/><path d="M114 300H235" stroke={C.accent} strokeWidth="3"/>
 <rect x="40" y="40" width="282" height="222" rx="59" fill="url(#sEdge)" stroke="#98a89c" strokeWidth="2"/>
 <rect x="47" y="47" width="268" height="208" rx="52" fill="url(#sMetal)"/>
 <rect x="65" y="86" width="230" height="121" rx="38" fill="url(#sGlass)" stroke={C.border} strokeWidth="2"/>
 <path d="M85 101Q166 83 272 102" fill="none" stroke={C.text} strokeOpacity=".1" strokeWidth="5"/>
 <g transform={`translate(${look} 146) scale(1 ${blink}) translate(0 -146)`}><rect x="108" y="126" width="35" height="39" rx="14" fill="url(#sSilver)"/><rect x="217" y="126" width="35" height="39" rx="14" fill="url(#sSilver)"/></g>
 <path d="M159 191H204" stroke="#98a89c" strokeWidth="4" strokeLinecap="round"/>
 <Mark x={162} y={53} size={35}/>
 <circle cx="54" cy="145" r="4" fill={C.border}/><circle cx="308" cy="145" r="4" fill={C.border}/>
 </g>;
}
export function ATMCard({x=0,y=0,width=520,angle=0,opacity=1}:{x?:number;y?:number;width?:number;angle?:number;opacity?:number}){
 const scale=width/600;
 return <g transform={`translate(${x} ${y}) rotate(${angle} ${300*scale} ${185*scale}) scale(${scale})`} opacity={opacity} filter="url(#sCast)">
 <rect x="-4" y="5" width="608" height="375" rx="23" fill={C.border}/><rect width="600" height="370" rx="20" fill="url(#sMetal)" stroke="#98a89c" strokeWidth="2"/>
 <rect width="600" height="370" rx="20" fill="url(#sGrain)"/><rect x="309" y="14" width="276" height="342" fill="url(#sTrace)"/>
 <rect x="12" y="12" width="576" height="346" rx="12" fill="none" stroke={C.muted} strokeOpacity=".18"/>
 <Mark x={33} y={28} size={45}/><text x="98" y="60" fill={C.text} fontSize="29" fontWeight="500" letterSpacing="-.5">IntentGuard</text>
 <text x="558" y="55" textAnchor="end" fill={C.muted} fontFamily="Plex Mono" fontSize="15" letterSpacing="1.5">AGENT ATM</text>
 <g transform="translate(40 111)"><rect width="82" height="65" rx="12" fill="url(#sChip)" stroke={C.accent}/><path d="M0 20H28V0M0 43H28V65M54 0V20H82M54 65V43H82M28 20H54V43H28ZM41 20V0M41 43V65M0 32H28M54 32H82" stroke={C.border} strokeWidth="1.5" fill="none"/></g>
 <g transform="translate(145 123)" fill="none" stroke="#98a89c" strokeWidth="3" strokeLinecap="round"><path d="M0 11Q7 20 0 29M8 5Q21 20 8 36M17 -1Q36 20 17 43"/></g>
 <text x="40" y="237" fill={C.text} fontSize="37" fontWeight="500" letterSpacing="-.5">Permission</text><text x="40" y="280" fill={C.text} fontSize="37" fontWeight="500" letterSpacing="-.5">before payment.</text>
 <path d="M40 303H558" stroke={C.border}/><text x="40" y="334" fill={C.muted} fontFamily="Plex Mono" fontSize="14" letterSpacing="1">YOUR MANDATE. ONCHAIN.</text>
 <Mark x={400} y={131} size={125} color={C.border}/>
 </g>;
}
export function Plaque({x,y,width=440,label,sub,color=C.accent}:{x:number;y:number;width?:number;label:string;sub?:string;color?:string}){
 return <g transform={`translate(${x} ${y})`}><rect width={width} height={sub?100:74} rx="8" fill={C.surface} stroke={C.border} strokeWidth="2"/><path d={`M0 0H${width}`} stroke={color} strokeWidth="3"/><text x="24" y={sub?42:46} fill={color} fontFamily="Plex Mono" fontSize="24" letterSpacing="1">{label}</text>{sub?<text x="24" y="76" fill={C.muted} fontSize="22">{sub}</text>:null}</g>;
}
export function Reader({x,y,signal=0}:{x:number;y:number;signal?:number}){
 return <g transform={`translate(${x} ${y})`}><path d="M16 245L-5 417H234L213 245Z" fill="url(#sMetal)" stroke={C.border} strokeWidth="2"/><rect width="230" height="280" rx="20" fill="url(#sEdge)" stroke="#98a89c" strokeWidth="2"/><rect x="7" y="7" width="216" height="266" rx="14" fill="url(#sMetal)"/><rect x="26" y="37" width="178" height="129" rx="12" fill="url(#sGlass)" stroke={C.border}/><Mark x={91} y={82} size={48}/><path d="M28 208H204" stroke={C.accent} strokeOpacity={.2+signal*.8} strokeWidth="5"/><text x="116" y="245" textAnchor="middle" fill={C.muted} fontFamily="Plex Mono" fontSize="14">MANDATE READER</text></g>;
}
export function CircuitGate({x,y,progress=0,failed=false,open=0}:{x:number;y:number;progress?:number;failed?:boolean;open?:number}){
 const color=failed?C.danger:C.accent;
 return <g transform={`translate(${x} ${y})`}>
 <rect width="990" height="470" rx="16" fill="url(#sMetal)" stroke={C.border} strokeWidth="2"/><rect x="18" y="18" width="954" height="434" rx="12" fill={C.bg} stroke={C.border}/><rect x="20" y="21" width="950" height="430" fill="url(#sTrace)"/>
 <text x="48" y="72" fill={C.text} fontSize="38" fontWeight="500">TapeOut</text><text x="944" y="67" textAnchor="end" fill={C.muted} fontFamily="Plex Mono" fontSize="19">ONCHAIN NUMERICAL GATE</text>
 {[0,1,2,3].map((n)=><g key={n} transform={`translate(${60+n*183} 140)`}>
 <path d="M0 0H75Q132 0 132 58Q132 114 75 114H0Z" fill={C.surface} stroke={progress>(n+1)/5?color:C.border} strokeWidth="3"/><circle cx="144" cy="58" r="9" fill={C.bg} stroke={progress>(n+1)/5?color:C.border} strokeWidth="3"/>
 <path d="M-26 28H0M-26 87H0M154 58H183" stroke={progress>(n+1)/5?color:C.border} strokeWidth="3"/>
 <text x="56" y="161" textAnchor="middle" fill={C.muted} fontFamily="Plex Mono" fontSize="17">{["AMOUNT","BUDGET","RECIPIENT","ASSET"][n]}</text>
 </g>)}
 <g transform="translate(811 124)"><rect width="90" height="231" rx="8" fill={C.surface} stroke={C.border} strokeWidth="2"/><path d="M25 27V203M65 27V203" stroke={C.border} strokeWidth="4"/><g transform={`translate(0 ${-open*173})`}><rect x="-22" y="40" width="137" height="144" rx="4" fill="url(#sEdge)" stroke={color} strokeWidth="2"/><path d="M-5 63H98M-5 90H98M-5 118H98M-5 146H98" stroke={C.bg} strokeWidth="9"/></g></g>
 <path d="M50 395H941" stroke={C.border} strokeWidth="2"/><text x="52" y="428" fill={C.muted} fontFamily="Plex Mono" fontSize="18">EXACT UNITS · PINNED NETLIST · FAIL CLOSED</text>
 </g>;
}
