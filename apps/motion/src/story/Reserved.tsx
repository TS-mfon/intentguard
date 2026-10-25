import {useCurrentFrame} from "remotion";
import {ATMCard,C,Stage,CircuitGate,Plaque,motion} from "./Assets";
export function ReservedScene(){
 const f=useCurrentFrame(),evaluation=motion(f,3,33,0,1),gate=motion(f,34,48,0,1),travel=motion(f,43,90,0,1);
 return <Stage title="A permitted request reserves its budget." subtitle="Pending reservations consume the limits. A balance is not permission." camera={motion(f,0,119,1.02,.98)}>
 <CircuitGate x={520} y={303} progress={evaluation} open={gate}/>
 <ATMCard x={264+travel*1040} y={612-travel*10} width={330} angle={motion(f,45,90,-8,0)}/>
 <path d="M383 503H1490" stroke={C.accent} strokeWidth="4" strokeDasharray="9 6" opacity={evaluation*.5}/>
 <g transform="translate(1550 420)"><path d="M0 0H148V272H0Z" fill="url(#sMetal)" stroke={C.border} strokeWidth="3"/><path d="M19 22H129V250H19Z" fill={C.bg} stroke={C.border}/><circle cx="76" cy="138" r="34" fill={C.surface} stroke={C.accent} strokeWidth="2"/><path d="M76 117V159M55 138H97" stroke={C.accent} strokeWidth="3"/></g>
 {f>=48?<Plaque x={536} y={819} width={655} label="GUARD PASSED · FUNDS RESERVED" sub="Same request. Same recipient. Exact amount."/>:null}
 <text x="1550" y="764" fill={C.muted} fontFamily="Plex Mono" fontSize="22">ISOLATED VAULT</text>
 </Stage>;
}
