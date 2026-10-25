import {useCurrentFrame} from "remotion";
import {Agent,ATMCard,C,Stage,Plaque,motion} from "./Assets";
export function IntentScene(){
 const f=useCurrentFrame(),assembly=motion(f,15,65,0,1),present=motion(f,96,132,0,1);
 return <Stage title="An agent forms an intent." subtitle="The human's mission and boundaries travel with every purchase." camera={motion(f,0,149,1,1.035)} cameraY={-12}>
 <Agent x={300} y={273} scale={1.32} reach={present*85} look={3}/>
 <g opacity={assembly}><path d="M740 510H1120V407M740 510H1120V623" fill="none" stroke={C.border} strokeWidth="3" strokeDasharray="9 7"/>
 <Plaque x={1000} y={286+motion(f,20,65,-40,0)} width={610} label="HUMAN MANDATE" sub="Mission · merchant · budget · evidence"/>
 <Plaque x={1100} y={433} width={510} label="PURCHASE INTENT" sub="Bound to the owner's policy"/>
 </g>
 <ATMCard x={motion(f,95,135,860,775)} y={motion(f,95,135,560,502)} width={610} angle={motion(f,95,135,-4,-13)} opacity={assembly}/>
 <path d="M1019 321v27" stroke={C.accent} strokeWidth="3"/>
 </Stage>;
}
