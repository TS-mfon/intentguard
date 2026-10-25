import {useCurrentFrame} from "remotion";
import {ATMCard,C,Stage,CircuitGate,Plaque,motion} from "./Assets";
export function BlockedScene(){
 const f=useCurrentFrame(),evaluation=motion(f,2,60,0,1),blocked=f>=59;
 return <Stage title="TapeOut stops an over-limit request." subtitle="The circuit evaluates exact units on X Layer before any evidence review." camera={motion(f,0,119,1.01,1.045)} cameraX={-25}>
 <CircuitGate x={640} y={319} progress={evaluation} failed={blocked}/>
 <ATMCard x={blocked?motion(f,64,96,334,210):motion(f,0,48,190,334)} y={542} width={390} angle={-8}/>
 <path d="M432 459H639" stroke={blocked?C.danger:C.border} strokeWidth="4" strokeDasharray={blocked?"0":"10 8"}/>
 {blocked?<><Plaque x={708} y={800} width={420} label="BLOCKED" sub="Payment limit exceeded" color={C.danger}/><Plaque x={1160} y={800} width={510} label="GENLAYER REVIEW SKIPPED" sub="No reservation or token transfer" color={C.muted}/></>:null}
 </Stage>;
}
