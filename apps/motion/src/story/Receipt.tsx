import {useCurrentFrame} from "remotion";
import {Agent,ATMCard,C,Stage,Plaque,Mark,motion} from "./Assets";
export function ReceiptScene(){
 const f=useCurrentFrame(),receipt=motion(f,0,34,0,1);
 return <Stage title="The merchant receives funds. The receipt remains." subtitle="Trace the mandate, guard, evidence decision and actual settlement." camera={motion(f,0,119,1.025,1)}>
 <Agent x={263} y={314} scale={1.24} reach={82} look={5}/>
 <ATMCard x={548} y={587} width={455} angle={-12}/>
 <g transform={`translate(1162 ${292+motion(f,0,35,-100,0)})`} opacity={receipt}>
 <path d="M0 0H471V486l-23-15-23 15-23-15-23 15-23-15-23 15-23-15-23 15-23-15-23 15-23-15-23 15-23-15-23 15-23-15-23 15-23-15-34 15Z" fill="#d6dfd4" stroke="#98a89c" strokeWidth="2"/>
 <Mark x={30} y={34} size={62} color={C.bg}/><text x="113" y="83" fill={C.bg} fontSize="38" fontWeight="500">IntentGuard</text>
 <path d="M31 111H438" stroke={C.border} strokeWidth="2"/>
 <text x="32" y="178" fill={C.bg} fontFamily="Plex Mono" fontSize="44">PAID</text><path d="M342 150l20 20 34-43" fill="none" stroke="#33483d" strokeWidth="6"/>
 {["Owner mandate bound","TapeOut guard passed","GenLayer result finalized","X Layer transfer confirmed"].map((text,i)=><g key={text}><path d={`M33 ${231+i*48}l7 7 13-18`} fill="none" stroke="#33483d" strokeWidth="3"/><text x="72" y={237+i*48} fill={C.bg} fontSize="24">{text}</text></g>)}
 </g>
 {f>45?<Plaque x={577} y={830} width={758} label="ACTUAL RECEIPTS LIVE IN THE EXPLORER" sub="This film illustrates the protocol; it is not a live payment."/>:null}
 </Stage>;
}
