import {useCurrentFrame} from "remotion";
import {C,Stage,Plaque,Mark,motion} from "./Assets";
export function EvidenceScene(){
 const f=useCurrentFrame(),assembly=motion(f,0,35,0,1);
 return <Stage title="GenLayer asks: does this purchase belong?" subtitle="Committed evidence and mission fit are independently validated." camera={motion(f,0,149,1.025,1)}>
 <g transform="translate(210 365)">
 {["REQUEST","POLICY","EVIDENCE"].map((label,i)=><g key={label} transform={`translate(${i*16} ${i*135+motion(f,0,32,50,0)})`} opacity={assembly}><rect width="450" height="103" rx="8" fill="url(#sMetal)" stroke={C.border} strokeWidth="2"/><text x="28" y="43" fill={C.text} fontFamily="Plex Mono" fontSize="26">{label} COMMITMENT</text><path d="M30 67H388M30 81H309" stroke={C.border} strokeWidth="4"/></g>)}
 </g>
 <path d="M707 571H840M1040 570H1134V383H1250M1134 570H1250M1134 570V757H1250" fill="none" stroke={C.accent} strokeWidth="3" strokeDasharray="10 8" strokeDashoffset={-f*1.5} opacity={assembly}/>
 <g transform="translate(850 473)"><rect width="198" height="198" rx="22" fill="url(#sMetal)" stroke={C.accent} strokeWidth="2"/><Mark x={54} y={53} size={90}/><text x="99" y="249" textAnchor="middle" fill={C.text} fontSize="31">GenLayer</text></g>
 {[0,1,2].map((i)=>{const confirmed=f>=82+i*18;return <g key={i} transform={`translate(1250 ${319+i*187})`}><rect width="425" height="131" rx="8" fill={C.surface} stroke={confirmed?C.accent:C.border} strokeWidth="2"/><text x="26" y="48" fill={confirmed?C.accent:C.muted} fontFamily="Plex Mono" fontSize="25">{["INVOICE MATCH","PURPOSE FIT","REQUIRED EVIDENCE"][i]}</text><text x="26" y="87" fill={C.muted} fontSize="22">{confirmed?"Independent finding committed":"Validator checks the evidence"}</text>{confirmed?<path d="M357 56l14 14 27-32" fill="none" stroke={C.accent} strokeWidth="5"/>:null}</g>})}
 {f>=125?<Plaque x={714} y={813} width={725} label="FINALIZED APPROVAL" sub="Optimistic Democracy · challenges and appeals"/>:<text x="791" y="868" fill={C.muted} fontSize="24">Validator set varies by round. Illustration only.</text>}
 </Stage>;
}
