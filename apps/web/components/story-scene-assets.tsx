"use client";

import {forwardRef, useEffect, useMemo, useRef} from "react";
import {useFrame} from "@react-three/fiber";
import {RoundedBox} from "@react-three/drei";
import {CanvasTexture, DoubleSide, ExtrudeGeometry, Group, Shape, ShapeGeometry, SRGBColorSpace, Vector3, CubicBezierCurve3} from "three";

const graphite = "#35443d";
const silver = "#aebcb2";
const accent = "#b5d7ae";
const dark = "#101716";
const danger = "#f4a8a3";

export function smoothRange(value:number, from:number, to:number) {
  const t = Math.max(0, Math.min(1, (value-from)/(to-from)));
  return t*t*(3-2*t);
}

function useEtching(draw:(ctx:CanvasRenderingContext2D,width:number,height:number)=>void, key:string, width=1024, height=640) {
  const texture = useMemo(()=>{
    const canvas = document.createElement("canvas");
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext("2d");
    if (!ctx) throw new Error("The scene's engraved artwork could not be created.");
    draw(ctx,width,height);
    const map=new CanvasTexture(canvas);
    map.colorSpace=SRGBColorSpace; map.anisotropy=4;
    return map;
    // The key describes all texture inputs; artwork is generated once per variant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,width,height]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return texture;
}

function mark(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,color:string) {
  ctx.fillStyle=color;
  const s=size/40;
  for(const [a,b,w,h] of [[8,5,9,12],[23,23,9,12],[8,23,9,12],[23,5,9,12]])ctx.fillRect(x+a*s,y+b*s,w*s,h*s);
  ctx.fillRect(x+5*s,y+18.5*s,30*s,3*s);
  ctx.fillRect(x+19*s,y+8*s,2*s,5*s);
  ctx.fillRect(x+19*s,y+27*s,2*s,5*s);
}

function brushed(ctx:CanvasRenderingContext2D,w:number,h:number,base:string) {
  ctx.fillStyle=base;ctx.fillRect(0,0,w,h);
  // Deterministic, horizontal machining lines. No downloaded surface assets.
  for(let y=0;y<h;y+=2) {
    const n=((y*73+17)%101)/101;
    ctx.fillStyle=n>.53?"rgba(237,242,236,.045)":"rgba(16,23,22,.075)";
    ctx.fillRect(0,y,w,1);
  }
}

function roundedShape(width:number,height:number,radius:number) {
  const x=-width/2,y=-height/2,r=Math.min(radius,width/2,height/2);
  const shape=new Shape();
  shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);
  shape.quadraticCurveTo(x+width,y,x+width,y+r);
  shape.lineTo(x+width,y+height-r);shape.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  shape.lineTo(x+r,y+height);shape.quadraticCurveTo(x,y+height,x,y+height-r);
  shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
  return shape;
}

function useCardGeometry() {
  const geometry=useMemo(()=>{
    const body=new ExtrudeGeometry(roundedShape(2.71,1.69,.16),{depth:.042,steps:1,bevelEnabled:true,bevelSegments:3,bevelSize:.018,bevelThickness:.016,curveSegments:12});
    body.translate(0,0,-.021);
    const face=new ShapeGeometry(roundedShape(2.65,1.63,.13),12);
    const pos=face.getAttribute("position"),uv=face.getAttribute("uv");
    for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+1.325)/2.65,(pos.getY(i)+.815)/1.63);
    return {body,face};
  },[]);
  useEffect(()=>()=>{geometry.body.dispose();geometry.face.dispose();},[geometry]);
  return geometry;
}

function Plate({size,position=[0,0,0],rotation=[0,0,0],color=graphite,roughness=.32,metalness=.86,radius=.08,children}:{size:[number,number,number];position?:[number,number,number];rotation?:[number,number,number];color?:string;roughness?:number;metalness?:number;radius?:number;children?:React.ReactNode}) {
  return <RoundedBox args={size} position={position} rotation={rotation} radius={Math.min(radius,...size.map(n=>n*.45))} smoothness={3} bevelSegments={3} castShadow receiveShadow>
    <meshPhysicalMaterial color={color} metalness={metalness} roughness={roughness} clearcoat={.16} clearcoatRoughness={.3}/>
    {children}
  </RoundedBox>;
}

function Screw({position,rotation=[Math.PI/2,0,0],size=.046}:{position:[number,number,number];rotation?:[number,number,number];size?:number}) {
  return <group position={position} rotation={rotation}>
    <mesh castShadow><cylinderGeometry args={[size,size,size*.35,12]}/><meshStandardMaterial color={silver} metalness={1} roughness={.32}/></mesh>
    <mesh position={[0,size*.21,0]}><boxGeometry args={[size*1.2,.007,.008]}/><meshStandardMaterial color={dark}/></mesh>
  </group>;
}

function Label({title,sub="",width=1.2,height=.32,color=accent,base=dark,position=[0,0,0],rotation=[0,0,0]}:{title:string;sub?:string;width?:number;height?:number;color?:string;base?:string;position?:[number,number,number];rotation?:[number,number,number]}) {
  const texture=useEtching((ctx,w,h)=>{
    brushed(ctx,w,h,base);
    ctx.fillStyle=color;ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.font="600 100px 'IBM Plex Sans Condensed', Arial, sans-serif";
    ctx.fillText(title,w/2,sub?h*.36:h*.51,w*.9);
    if(sub){ctx.font="500 45px 'IBM Plex Mono', monospace";ctx.fillText(sub,w/2,h*.76,w*.88);}
  },title+sub+color+base,1024,256);
  return <mesh position={position} rotation={rotation}><planeGeometry args={[width,height]}/><meshStandardMaterial map={texture} roughness={.63} metalness={.36}/></mesh>;
}

export const AgentCard=forwardRef<Group>(function AgentCard(_,ref) {
  const geometry=useCardGeometry();
  const face=useEtching((ctx,w,h)=>{
    brushed(ctx,w,h,"#607068");
    const margin=48;
    ctx.strokeStyle="#aebcb2";ctx.lineWidth=2;ctx.strokeRect(margin,margin,w-margin*2,h-margin*2);
    mark(ctx,60,66,91,"#edf2ec");
    ctx.fillStyle="#edf2ec";ctx.font="600 61px 'IBM Plex Sans', Arial, sans-serif";ctx.fillText("IntentGuard",170,127);
    ctx.fillStyle="#d0ded2";ctx.font="500 22px 'IBM Plex Mono', monospace";ctx.fillText("AGENT ATM CARD",680,111);
    ctx.strokeStyle="#a5b8aa";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(65,179);ctx.lineTo(959,179);ctx.stroke();
    ctx.fillStyle="#edf2ec";ctx.font="600 58px 'IBM Plex Sans Condensed', Arial, sans-serif";ctx.fillText("INTELLIGENCE.",72,440);ctx.fillText("WITH PERMISSION.",72,503);
    ctx.fillStyle="#d7e2d8";ctx.font="500 20px 'IBM Plex Mono', monospace";ctx.fillText("OWNER-DEFINED MANDATE",72,561);
    ctx.fillStyle="#d7e2d8";ctx.font="500 18px 'IBM Plex Mono', monospace";ctx.textAlign="right";ctx.fillText("ISSUED INSTRUMENT",951,561);
    // An original split-slot engraving fills the empty physical right quadrant.
    mark(ctx,768,231,180,"#b5d7ae");
  },"card-face");
  const chip=useEtching((ctx,w,h)=>{
    brushed(ctx,w,h,"#b2bea6");
    ctx.strokeStyle="#3a4a3d";ctx.lineWidth=7;
    ctx.beginPath();ctx.roundRect(w*.32,h*.2,w*.36,h*.6,24);ctx.stroke();
    for(const y of [.32,.5,.68]){ctx.beginPath();ctx.moveTo(0,h*y);ctx.lineTo(w*.32,h*y);ctx.moveTo(w*.68,h*y);ctx.lineTo(w,h*y);ctx.stroke();}
    for(const x of [.43,.57]){ctx.beginPath();ctx.moveTo(w*x,0);ctx.lineTo(w*x,h*.2);ctx.moveTo(w*x,h*.8);ctx.lineTo(w*x,h);ctx.stroke();}
  },"chip",512,384);
  return <group ref={ref}>
    <mesh geometry={geometry.body} castShadow receiveShadow><meshPhysicalMaterial color="#79877e" metalness={.96} roughness={.25} clearcoat={.22}/></mesh>
    <mesh geometry={geometry.face} position={[0,0,.043]}><meshPhysicalMaterial map={face} metalness={.77} roughness={.43} clearcoat={.22}/></mesh>
    <Plate size={[.57,.43,.025]} position={[-.88,.135,.061]} color="#b5c1a9" radius={.06} roughness={.3}/>
    <mesh position={[-.88,.135,.077]}><planeGeometry args={[.51,.37]}/><meshStandardMaterial map={chip} metalness={.85} roughness={.35}/></mesh>
    <mesh position={[0,.38,-.041]} rotation={[0,Math.PI,0]}><planeGeometry args={[2.6,.22]}/><meshStandardMaterial color="#14201a" roughness={.56}/></mesh>
    <Label title="OWNER PERMISSION" sub="EXACT LIMITS · COMMITTED EVIDENCE" width={2.2} height={.42} position={[0,-.27,-.043]} rotation={[0,Math.PI,0]} base="#79877e" color={dark}/>
  </group>;
});

export const TerminalAgent=forwardRef<Group,{progress:number;active:boolean;reducedMotion:boolean}>(function TerminalAgent({progress,active,reducedMotion},ref) {
  const torso=useRef<Group>(null),leftArm=useRef<Group>(null),rightArm=useRef<Group>(null);
  const eyes=useRef<Group>(null),elapsed=useRef(0);
  useFrame((_,delta)=>{
    if(active&&!reducedMotion)elapsed.current+=Math.min(delta,.04);
    const t=elapsed.current;
    const breath=reducedMotion?0:Math.sin(t*1.25)*.028;
    if(torso.current)torso.current.position.y=breath;
    if(eyes.current) {
      const blink=active&&!reducedMotion&&t%7.6>7.44? .22:1;
      eyes.current.scale.y=blink;
    }
    const reach=smoothRange(progress,.23,.39)*(1-smoothRange(progress,.45,.65));
    if(leftArm.current)leftArm.current.rotation.z=.2-reach*.38;
    if(rightArm.current)rightArm.current.rotation.z=-.22+reach*.44;
  });
  return <group ref={ref}>
    <group ref={torso}>
      <Plate size={[2.28,2.42,1.35]} position={[0,.08,0]} radius={.29} color="#394a41" roughness={.29}/>
      <Plate size={[2.1,2.21,.18]} position={[0,.08,.66]} radius={.25} color="#718078" roughness={.27}/>
      <Plate size={[1.94,1.02,.12]} position={[0,.58,.784]} radius={.25} color="#121b18" roughness={.16} metalness={.32}/>
      <Plate size={[1.77,.81,.035]} position={[0,.59,.854]} radius={.2} color="#091310" roughness={.12} metalness={.42}/>
      <group ref={eyes} position={[0,.61,.89]}>
        {[-.43,.43].map(x=><group key={x} position={[x,0,0]}>
          <Plate size={[.21,.32,.036]} radius={.07} color="#edf2ec" roughness={.22} metalness={.72}/>
          <mesh position={[0,0,.021]}><planeGeometry args={[.13,.21]}/><meshStandardMaterial color="#d7e8d5" emissive="#b5d7ae" emissiveIntensity={.32} roughness={.3}/></mesh>
        </group>)}
      </group>
      <Plate size={[1.3,.075,.08]} position={[0,-.33,.785]} radius={.028} color={dark} roughness={.5}/>
      <Plate size={[1.36,.017,.022]} position={[0,-.385,.831]} radius={.006} color={accent} roughness={.3}/>
      <Label title="INTENTGUARD" sub="OWNER-DEFINED PERMISSION" width={1.6} height={.29} position={[0,-.74,.765]} base="#718078" color="#17231b"/>
      {[-.91,.91].flatMap(x=>[-.89,1.05].map(y=><Screw key={x+":"+y} position={[x,y,.785]}/>))}
      {[-1,1].map(side=><group key={side} position={[side*1.18,.18,0]} rotation={[0,0,Math.PI/2]}>
        <mesh castShadow><cylinderGeometry args={[.29,.29,.19,24]}/><meshStandardMaterial color="#98a99c" metalness={.94} roughness={.28}/></mesh>
        <mesh position={[0,.1,0]}><cylinderGeometry args={[.16,.16,.024,24]}/><meshStandardMaterial color="#26362c" metalness={.9} roughness={.35}/></mesh>
      </group>)}
      <group position={[-1.32,.18,.05]} ref={leftArm} rotation={[0,0,.2]}>
        <Plate size={[.35,.76,.39]} position={[0,-.4,0]} radius={.14} color="#465a4c"/>
        <mesh position={[0,-.83,0]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.2,.2,.42,24]}/><meshStandardMaterial color={silver} metalness={.95} roughness={.25}/></mesh>
        <group position={[0,-.87,0]} rotation={[-.95,0,-.16]}>
          <Plate size={[.33,.71,.35]} position={[0,-.32,0]} radius={.11} color="#526757"/>
          <Plate size={[.44,.3,.35]} position={[0,-.71,.025]} radius={.1} color="#98a99a"/>
          {[-.12,.12].map(x=><Plate key={x} size={[.12,.26,.12]} position={[x,-.91,.1]} radius={.05} color="#aebcb2"/>)}
        </group>
      </group>
      <group position={[1.32,.18,.05]} ref={rightArm} rotation={[0,0,-.22]}>
        <Plate size={[.35,.76,.39]} position={[0,-.4,0]} radius={.14} color="#465a4c"/>
        <mesh position={[0,-.83,0]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.2,.2,.42,24]}/><meshStandardMaterial color={silver} metalness={.95} roughness={.25}/></mesh>
        <group position={[0,-.87,0]} rotation={[-1.02,0,.16]}>
          <Plate size={[.33,.71,.35]} position={[0,-.32,0]} radius={.11} color="#526757"/>
          <Plate size={[.44,.3,.35]} position={[0,-.71,.025]} radius={.1} color="#98a99a"/>
          {[-.12,.12].map(x=><Plate key={x} size={[.12,.26,.12]} position={[x,-.91,.1]} radius={.05} color="#aebcb2"/>)}
        </group>
      </group>
      <Plate size={[1.5,.32,.9]} position={[0,-1.32,0]} radius={.11} color="#202d25"/>
      {[-.6,.6].map(x=><group key={x} position={[x,-1.71,.08]}>
        <Plate size={[.57,.59,.63]} radius={.16} color="#65776a"/>
        <Plate size={[.77,.31,1.04]} position={[0,-.39,.17]} radius={.14} color="#445849"/>
        <Plate size={[.6,.04,.78]} position={[0,-.57,.16]} radius={.015} color="#101c15" roughness={.7}/>
      </group>)}
      <mesh position={[0,1.39,-.18]} castShadow><cylinderGeometry args={[.12,.15,.16,20]}/><meshStandardMaterial color="#adbaae" metalness={.92} roughness={.24}/></mesh>
      <mesh position={[0,1.5,-.18]}><sphereGeometry args={[.095,16,12]}/><meshStandardMaterial color={accent} metalness={.5} roughness={.2}/></mesh>
      {[0,1,2,3,4].map(i=><Plate key={i} size={[.65,.024,.022]} position={[0,1.05-i*.075,-.69]} radius={.008} color={dark} roughness={.8}/>)}
    </group>
  </group>;
});

export const TapeOutGate=forwardRef<Group,{progress:number;blocked:boolean}>(function TapeOutGate({progress,blocked},ref) {
  const left=useRef<Group>(null),right=useRef<Group>(null);
  useFrame(()=>{
    const opening=blocked?0:smoothRange(progress,.36,.47);
    if(left.current)left.current.position.x=-.42-opening*.55;
    if(right.current)right.current.position.x=.42+opening*.55;
  });
  return <group ref={ref}>
    <Plate size={[3.55,.3,1.55]} position={[0,-1.73,0]} radius={.12} color="#536358"/>
    {[-1.47,1.47].map(x=><group key={x} position={[x,-.2,0]}>
      <Plate size={[.54,2.95,.92]} radius={.15} color="#728175"/>
      <Plate size={[.17,2.45,.045]} position={[0,0,.486]} radius={.025} color="#223a2b"/>
      <Plate size={[.045,2.27,.023]} position={[0,0,.519]} radius={.008} color={blocked?danger:accent}/>
      {[-1.14,1.14].map(y=><Screw key={y} position={[0,y,.486]} size={.06}/>)}
    </group>)}
    <Plate size={[3.55,.68,1.1]} position={[0,1.19,0]} radius={.15} color="#718175"/>
    <Label title="TAPEOUT" sub="MANDATORY EXACT CHECKS" width={2.37} height={.43} position={[0,1.19,.562]} base="#718175" color={dark}/>
    <group ref={left} position={[-.42,-.17,0]}>
      <Plate size={[.79,2.1,.31]} position={[0,0,.1]} radius={.11} color="#495f4e" roughness={.36}/>
      {[0,1,2].map(i=><Plate key={i} size={[.7,.026,.015]} position={[0,.56-i*.53,.268]} radius={.005} color="#9cab9e"/>)}
    </group>
    <group ref={right} position={[.42,-.17,0]}>
      <Plate size={[.79,2.1,.31]} position={[0,0,.1]} radius={.11} color="#495f4e" roughness={.36}/>
      {[0,1,2].map(i=><Plate key={i} size={[.7,.026,.015]} position={[0,.56-i*.53,.268]} radius={.005} color="#9cab9e"/>)}
    </group>
    <group position={[-1.75,-.34,.76]} rotation={[-.28,-.12,0]}>
      <Plate size={[.94,1.14,.36]} radius={.15} color="#6e8070"/>
      <Label title={blocked?"BLOCKED":"CARD READER"} sub={blocked?"REVIEW SKIPPED":"TAP TO CHECK"} width={.77} height={.44} position={[0,.18,.191]} color={blocked?danger:accent}/>
      <Plate size={[.67,.065,.05]} position={[0,-.22,.196]} radius={.022} color={dark}/>
      <mesh position={[0,-.39,.197]}><circleGeometry args={[.032,16]}/><meshStandardMaterial color={blocked?danger:accent} emissive={blocked?danger:accent} emissiveIntensity={.3}/></mesh>
    </group>
  </group>;
});

export const EvidenceInstrument=forwardRef<Group,{progress:number;blocked:boolean;active:boolean;reducedMotion:boolean}>(function EvidenceInstrument({progress,blocked,active,reducedMotion},ref) {
  const ring=useRef<Group>(null),time=useRef(0);
  useFrame((_,delta)=>{
    if(active&&!reducedMotion)time.current+=Math.min(delta,.04);
    if(ring.current)ring.current.rotation.z=blocked?0:.1+smoothRange(progress,.49,.64)*.9+(reducedMotion?0:Math.sin(time.current*.35)*.04);
  });
  return <group ref={ref}>
    <Plate size={[3.6,.31,1.75]} position={[0,-1.9,0]} radius={.14} color="#4c6251"/>
    {[-1.36,1.36].map(x=><Plate key={x} size={[.24,2.28,.3]} position={[x,-.66,-.23]} radius={.08} color="#8b9a8c"/>)}
    <group ref={ring} rotation={[0,0,.1]}>
      <mesh rotation={[Math.PI/2,0,0]} castShadow><torusGeometry args={[1.49,.11,12,64]}/><meshStandardMaterial color="#9fad9f" metalness={1} roughness={.24}/></mesh>
      <mesh castShadow><torusGeometry args={[1.49,.14,12,64]}/><meshPhysicalMaterial color="#5d7561" metalness={.96} roughness={.3}/></mesh>
      <mesh position={[0,0,.03]}><torusGeometry args={[1.27,.023,8,64]}/><meshStandardMaterial color={blocked?"#526359":accent} metalness={.7} roughness={.3}/></mesh>
      <mesh position={[0,0,-.25]} rotation={[.15,-.17,0]}><torusGeometry args={[1.18,.037,10,64]}/><meshStandardMaterial color="#aebcb2" metalness={1} roughness={.25}/></mesh>
    </group>
    {/* A single evidence bundle and its review instrument; no claimed validator count. */}
    <group position={[0,0,.1]} rotation={[0,-.15,-.035]}>
      <Plate size={[1.45,1.89,.12]} position={[.12,.02,-.25]} radius={.075} color="#a5b3a5"/>
      <Plate size={[1.45,1.89,.12]} position={[-.08,-.015,-.08]} radius={.075} color="#657f68"/>
      <Plate size={[1.45,1.89,.12]} radius={.075} color="#bbc8b8"/>
      <Label title={blocked?"REVIEW SKIPPED":"COMMITTED"} sub={blocked?"EXACT CHECK FAILED":"EVIDENCE"} width={1.2} height={.48} position={[0,.48,.07]} color={blocked?"#543b35":"#293d2d"} base="#bbc8b8"/>
      {[0,1,2,3,4].map(i=><Plate key={i} size={[1.03-(i%2)*.22,.024,.008]} position={[-(i%2)*.11,.04-i*.13,.072]} radius={.003} color="#526a56" roughness={.8}/>)}
      <Plate size={[1.04,.04,.01]} position={[0,-.66,.073]} radius={.005} color="#526a56"/>
    </group>
    <Label title={blocked?"NO REVIEW":"INDEPENDENT REVIEW"} sub={blocked?"NO TRANSFER":"GENLAYER · OPTIMISTIC DEMOCRACY"} width={2.85} height={.4} position={[0,-1.72,.91]} base="#4c6251" color={blocked?danger:"#edf2ec"}/>
  </group>;
});

export const settlementCurve = new CubicBezierCurve3(new Vector3(-1.27,-.74,.78),new Vector3(-.05,.72,.93),new Vector3(1.15,.76,.93),new Vector3(2.44,-.59,.78));

export const SettlementInstrument=forwardRef<Group,{progress:number;blocked:boolean}>(function SettlementInstrument({progress,blocked},ref) {
  const coin=useRef<Group>(null),door=useRef<Group>(null);
  const point=useMemo(()=>new Vector3(),[]);
  const line=useMemo(()=>settlementCurve.clone(),[]);
  useFrame(()=>{
    const movement=smoothRange(progress,.72,.82);
    if(coin.current) {
      coin.current.visible=!blocked&&progress>.71&&progress<.845;
      settlementCurve.getPoint(movement,point);
      coin.current.position.copy(point);
      coin.current.rotation.set(.1,Math.PI/2+movement*Math.PI*2,0);
    }
    if(door.current)door.current.rotation.y=blocked?0:-smoothRange(progress,.685,.735)*.68;
  });
  return <group ref={ref}>
    <Plate size={[5.7,.28,2.06]} position={[.58,-1.95,0]} radius={.14} color="#475e4b"/>
    <group position={[-1.43,-.74,0]}>
      <Plate size={[1.89,2.02,1.48]} radius={.23} color="#6e8170" roughness={.25}/>
      <mesh position={[0,0,.77]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.76,.76,.12,48]}/><meshStandardMaterial color="#263e2b" metalness={.93} roughness={.34}/></mesh>
      <group ref={door} position={[-.68,0,.83]}>
        <group position={[.68,0,0]}>
          <mesh rotation={[Math.PI/2,0,0]} castShadow><cylinderGeometry args={[.7,.7,.13,48]}/><meshStandardMaterial color="#859682" metalness={.94} roughness={.26}/></mesh>
          <mesh position={[0,0,.085]}><torusGeometry args={[.51,.043,10,40]}/><meshStandardMaterial color="#d3dec9" metalness={1} roughness={.26}/></mesh>
          <Plate size={[.075,.7,.07]} position={[0,0,.125]} radius={.03} color="#d3dec9"/>
          <Plate size={[.7,.075,.07]} position={[0,0,.125]} radius={.03} color="#d3dec9"/>
          <mesh position={[0,0,.19]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.13,.13,.13,24]}/><meshStandardMaterial color="#4c684f" metalness={1} roughness={.2}/></mesh>
          {[0,1,2,3,4,5].map(i=><Screw key={i} position={[Math.sin(i*Math.PI/3)*.6,Math.cos(i*Math.PI/3)*.6,.083]} size={.044}/>)}
        </group>
      </group>
      <Label title="RESERVE" sub="RECHECK ON X LAYER" width={1.5} height={.35} position={[0,1.03,.33]} rotation={[-.4,0,0]} base="#6e8170" color={dark}/>
    </group>
    <mesh><tubeGeometry args={[line,48,.027,8,false]}/><meshStandardMaterial color={blocked?"#526359":"#aabca5"} metalness={.9} roughness={.32}/></mesh>
    <group ref={coin} visible={false}>
      <mesh rotation={[Math.PI/2,0,0]} castShadow><cylinderGeometry args={[.24,.24,.06,32]}/><meshStandardMaterial color={accent} metalness={.9} roughness={.23}/></mesh>
      <mesh position={[0,0,.036]}><torusGeometry args={[.18,.012,6,32]}/><meshStandardMaterial color="#263d28" metalness={.8} roughness={.25}/></mesh>
      <Label title="T" width={.19} height={.2} position={[0,0,.04]} base={accent} color="#263d28"/>
    </group>
    <group position={[2.63,-.85,0]} rotation={[-.14,-.1,0]}>
      <Plate size={[1.9,.43,1.65]} position={[0,-.7,.18]} radius={.18} color="#718771"/>
      <Plate size={[1.37,1.62,.49]} position={[0,.12,0]} radius={.18} color="#758a75" roughness={.25}/>
      <Plate size={[1.17,.89,.065]} position={[0,.37,.279]} radius={.1} color={dark}/>
      <Label title="MERCHANT" sub={blocked?"NO TRANSFER":progress>=.82?"SETTLED":"AWAITING SETTLEMENT"} width={1.02} height={.51} position={[0,.41,.318]} color={blocked?danger:accent}/>
      <Plate size={[.93,.06,.06]} position={[0,-.28,.289]} radius={.02} color={dark}/>
      {[0,1,2,3].map(i=><Plate key={i} size={[.12,.09,.027]} position={[-.3+i*.2,-.42,.274]} radius={.015} color="#cedbc7"/>)}
      <Label title="X LAYER" sub="TESTNET ILLUSTRATION" width={1.49} height={.3} position={[0,-.71,1.017]} base="#718771" color={dark}/>
    </group>
  </group>;
});

export const SettlementReceipt=forwardRef<Group,{blocked:boolean}>(function SettlementReceipt({blocked},ref) {
  const texture=useEtching((ctx,w,h)=>{
    brushed(ctx,w,h,"#dce6d7");
    mark(ctx,54,41,105,"#314a34");
    ctx.fillStyle="#314a34";ctx.font="600 59px 'IBM Plex Sans', Arial, sans-serif";ctx.fillText("IntentGuard",176,115);
    ctx.fillStyle="#314a34";ctx.font="500 23px 'IBM Plex Mono', monospace";ctx.fillText("PROTOCOL RECEIPT",65,187);
    ctx.strokeStyle="#789178";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(64,229);ctx.lineTo(w-64,229);ctx.stroke();
    ctx.fillStyle=blocked?"#72453b":"#314a34";ctx.font="600 105px 'IBM Plex Sans Condensed', Arial, sans-serif";ctx.fillText(blocked?"BLOCKED":"PAID",62,377);
    ctx.fillStyle="#314a34";ctx.font="500 29px 'IBM Plex Mono', monospace";ctx.fillText(blocked?"REVIEW SKIPPED":"SETTLED ON X LAYER",65,447);
    ctx.fillText(blocked?"NO TRANSFER":"TESTNET ILLUSTRATION",65,503);
    ctx.strokeStyle="#789178";ctx.beginPath();ctx.moveTo(64,550);ctx.lineTo(w-64,550);ctx.stroke();
    ctx.font="500 24px 'IBM Plex Mono', monospace";ctx.fillText("HUMAN PERMISSION REMAINS",65,612);
    // Machine-readable-looking engraving is visibly marked as an illustration.
    for(let i=0;i<47;i++){ctx.fillStyle="#526b51";ctx.fillRect(65+i*15,660,4+(i*7%6),80);}
    ctx.font="500 20px 'IBM Plex Mono', monospace";ctx.fillText("ILLUSTRATED PROTOCOL · NO MONETARY VALUE",65,785);
  },"receipt-"+blocked,832,896);
  return <group ref={ref}>
    <Plate size={[1.72,1.87,.035]} radius={.06} color="#dce6d7" metalness={.05} roughness={.84}/>
    <mesh position={[0,0,.021]}><planeGeometry args={[1.66,1.79]}/><meshStandardMaterial map={texture} roughness={.83} metalness={.02} side={DoubleSide}/></mesh>
    <mesh position={[0,-.93,-.017]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.07,.07,1.66,24]}/><meshStandardMaterial color="#c4d1bd" roughness={.8}/></mesh>
  </group>;
});
