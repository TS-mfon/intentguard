import {useCurrentFrame} from "remotion";
import {ATMCard,C,Stage,Plaque,Mark,motion} from "./Assets";
export function SettlementScene(){
 const f=useCurrentFrame(),recheck=motion(f,25,68,0,1),travel=motion(f,80,108,0,1);
 return <Stage title="Approval is checked again before funds move." subtitle="X Layer settles only the signed release bound to this request and evidence." camera={motion(f,0,119,1.05,1)} cameraX={-12}>
 <g transform="translate(268 399)"><rect width="388" height="369" rx="20" fill="url(#sMetal)" stroke={C.border} strokeWidth="3"/><rect x="28" y="73" width="332" height="210" rx="12" fill={C.bg} stroke={C.border}/><Mark x={138} y={116} size={110}/><text x="194" y="336" textAnchor="middle" fill={C.text} fontFamily="Plex Mono" fontSize="25">AGENT VAULT</text></g>
 <ATMCard x={motion(f,2,25,710,785)} y={313} width={380} angle={motion(f,2,25,-18,-3)}/>
 <g transform="translate(825 593)"><rect width="269" height="180" rx="12" fill={C.surface} stroke={recheck===1?C.accent:C.border} strokeWidth="3"/><path d="M50 40H219M50 75H219M50 110H219" stroke={recheck===1?C.accent:C.border} strokeWidth="4"/><text x="134" y="155" textAnchor="middle" fill={C.text} fontFamily="Plex Mono" fontSize="20">TAPEOUT RECHECK</text></g>
 <path d="M656 682H825M1094 682H1485" fill="none" stroke={C.border} strokeWidth="4"/>
 <path d="M1094 682H1485" fill="none" stroke={C.accent} strokeWidth="5" strokeDasharray="391" strokeDashoffset={391*(1-travel)}/>
 {[0,1,2].map(i=><g key={i} opacity={f>=81?1:0} transform={`translate(${1108+travel*380-i*23} 682)`}><rect x="-12" y="-12" width="24" height="24" rx="5" fill="url(#sSilver)" stroke={C.accent}/></g>)}
 <g transform="translate(1487 409)"><path d="M0 58L150 0 300 58V359H0Z" fill="url(#sMetal)" stroke={C.border} strokeWidth="3"/><path d="M32 95H268M32 136H268" stroke={C.border} strokeWidth="5"/><rect x="80" y="176" width="140" height="129" rx="8" fill={C.bg} stroke={C.border}/><text x="149" y="340" textAnchor="middle" fill={C.text} fontFamily="Plex Mono" fontSize="25">MERCHANT</text></g>
 {recheck===1?<Plaque x={488} y={827} width={824} label="PERMISSION + FINALITY + EXACT TRANSFER" sub="The stored recipient receives the stored token amount."/>:null}
 </Stage>;
}
