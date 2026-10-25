import {useCurrentFrame} from "remotion";
import {Agent,ATMCard,C,Stage,Reader,motion} from "./Assets";
export function TapScene(){
 const f=useCurrentFrame(),present=motion(f,8,42,0,1),scan=motion(f,42,48,0,1);
 return <Stage title="The card presents the mandate." subtitle="The agent can request a purchase. It cannot rewrite its spending permission." camera={motion(f,0,119,1.04,1.09)} cameraX={-55} cameraY={-20}>
 <Agent x={210} y={288} scale={1.42} reach={present*190} look={6}/>
 <Reader x={1420} y={380} signal={scan}/>
 <g opacity={scan}>
 {[0,1,2].map(i=><ellipse key={i} cx="1508" cy="508" rx={52+i*26+(f%40)*.7} ry={80+i*35+(f%40)*.7} fill="none" stroke={C.accent} strokeWidth="2" opacity={.4-i*.08}/>)}
 </g>
 <ATMCard x={motion(f,8,42,695,1020)} y={motion(f,8,42,579,460)} width={510} angle={motion(f,8,42,-18,-7)}/>
 <path d="M520 875H1596" stroke={C.border} strokeWidth="2"/>
 <text x="1425" y="918" fill={C.accent} fontFamily="Plex Mono" fontSize="26">{scan?"REQUEST COMMITTED":"PRESENT CARD"}</text>
 </Stage>;
}
