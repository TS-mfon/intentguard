"use client";

import {Component, memo, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode, type RefObject} from "react";
import {addAfterEffect, Canvas, useFrame, useThree} from "@react-three/fiber";
import {Environment, Lightformer} from "@react-three/drei";
import {ACESFilmicToneMapping, Group, PerspectiveCamera, SRGBColorSpace, Vector3, type WebGLRenderer} from "three";
import {AgentCard, TerminalAgent, TapeOutGate, EvidenceInstrument, SettlementInstrument, SettlementReceipt, smoothRange} from "./story-scene-assets";

export interface StorySceneProps {
  progress:number;
  blocked:boolean;
  paused:boolean;
  reducedMotion:boolean;
  onReady?:()=>void;
  onError?:(message:string)=>void;
}

type Triple=[number,number,number];
type RigPose={position:Triple;rotation:Triple;scale:number};
type CameraPose={position:Triple;target:Triple;fov:number};

const cameraPoses:CameraPose[]=[
  {position:[5.3,2.2,8.7],target:[-1.5,-.12,0],fov:35},
  {position:[3.6,1.7,5.7],target:[2.45,.12,.8],fov:36},
  {position:[5.2,2.45,6.2],target:[-1.75,-.1,-2.0],fov:36},
  {position:[-4.6,2.3,4.7],target:[2.4,-.15,-4.0],fov:36},
  {position:[7.1,3.3,3.9],target:[-1.35,-.15,-5.1],fov:38},
  {position:[7.2,2.7,3.2],target:[-.7,-.05,-5.3],fov:35},
];

const agentPoses:RigPose[]=[
  {position:[.9,-.25,0],rotation:[0,.18,0],scale:1.04},
  {position:[-.9,-.3,-1.4],rotation:[0,.3,-.015],scale:1},
  {position:[-1.8,-.3,-2.6],rotation:[0,.5,0],scale:.98},
  {position:[-2.1,-.3,-3.5],rotation:[0,-.3,0],scale:.96},
  {position:[-.65,-.3,-5.6],rotation:[0,.2,0],scale:.94},
  {position:[1.0,-.28,-5.8],rotation:[0,.27,0],scale:1},
];
const cardPoses:RigPose[]=[
  {position:[.9,-.64,1.6],rotation:[-.07,.55,-.115],scale:1},
  {position:[.45,.12,1.85],rotation:[-.1,.22,-.14],scale:1.17},
  {position:[-.67,-.02,-1.36],rotation:[-.16,.62,-.1],scale:.7},
  {position:[.05,.03,-3.94],rotation:[-.02,-.33,.04],scale:.54},
  {position:[1.5,-.81,-4.77],rotation:[-.12,.75,-.15],scale:.58},
  {position:[1.02,-.69,-4.47],rotation:[-.06,.68,-.1],scale:.87},
];

function sampleTriples(a:Triple,b:Triple,t:number,target:Vector3) {
  return target.set(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t);
}
function place(group:Group|null,poses:RigPose[],index:number,t:number,point:Vector3,extraAngle=0) {
  if(!group)return;
  const a=poses[index],b=poses[Math.min(index+1,poses.length-1)];
  sampleTriples(a.position,b.position,t,point);
  group.position.copy(point);
  group.rotation.set(a.rotation[0]+(b.rotation[0]-a.rotation[0])*t,a.rotation[1]+(b.rotation[1]-a.rotation[1])*t+extraAngle,a.rotation[2]+(b.rotation[2]-a.rotation[2])*t);
  group.scale.setScalar(a.scale+(b.scale-a.scale)*t);
}

class SceneBoundary extends Component<{children:ReactNode;onError:(message:string)=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error,_info:ErrorInfo){this.props.onError(error.message||"The 3D renderer could not start.");}
  render(){return this.state.failed?null:this.props.children;}
}

const Studio=memo(function Studio() {
  return <>
    <ambientLight intensity={.47} color="#d0dfce"/>
    <directionalLight position={[2.8,8,5]} intensity={3.15} color="#e1e8d9" castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-camera-near={.5} shadow-camera-far={30} shadow-bias={-.0004} shadow-normalBias={.045} shadow-radius={3}/>
    <spotLight position={[-7,5,2]} angle={.68} penumbra={1} intensity={100} distance={24} color="#b5cbd4"/>
    <spotLight position={[6,4,-8]} angle={.72} penumbra={1} intensity={135} distance={24} color="#b5d7ae"/>
    {/* Original studio softboxes are captured once. No network HDRI or image assets. */}
    <Environment resolution={128} frames={1} environmentIntensity={.78}>
      <Lightformer form="rect" intensity={4} color="#edf2ec" scale={[7,3,1]} position={[-5,5,1]} rotation={[0,Math.PI/3,0]}/>
      <Lightformer form="rect" intensity={3.2} color="#d1decf" scale={[3,7,1]} position={[6,2,2]} rotation={[0,-Math.PI/3,0]}/>
      <Lightformer form="rect" intensity={2.8} color="#b5cbd4" scale={[1.1,8,1]} position={[-4,1,-5]} rotation={[0,Math.PI/2,0]}/>
      <Lightformer form="rect" intensity={2.5} color="#b5d7ae" scale={[6,1,1]} position={[0,5,-6]} rotation={[Math.PI/4,0,0]}/>
      <Lightformer form="rect" intensity={1.2} color="#eed09a" scale={[2,4,1]} position={[0,1,8]} rotation={[0,Math.PI,0]}/>
    </Environment>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-2.46,-2]} receiveShadow>
      <planeGeometry args={[160,160]}/>
      <meshLambertMaterial color="#101716"/>
    </mesh>
    <fog attach="fog" args={["#101716",16,37]}/>
  </>;
});

function Choreography({progress,blocked,active,reducedMotion,host,pointer,onFirstFrame,onDpr}:{progress:number;blocked:boolean;active:boolean;reducedMotion:boolean;host:RefObject<HTMLDivElement|null>;pointer:RefObject<{x:number;y:number}>;onFirstFrame:()=>void;onDpr:(dpr:number)=>void}) {
  const agent=useRef<Group>(null),card=useRef<Group>(null),gate=useRef<Group>(null),evidence=useRef<Group>(null),settlement=useRef<Group>(null),receipt=useRef<Group>(null);
  const {camera,size,invalidate,viewport}=useThree();
  const actualProgress=useRef(reducedMotion?0:progress),frames=useRef(0),firstFrame=useRef(false),readyRaf=useRef<number|null>(null);
  const time=useRef(0),pointerCurrent=useRef({x:0,y:0});
  const quality=useRef({changes:0,warmFrames:0,samples:0,seconds:0});
  const point=useMemoVector(),cameraPoint=useMemoVector(),lookAt=useMemoVector(),cameraDistance=useMemoVector();
  // A paused demand scene still needs a deliberate frame for resize/branch changes.
  useEffect(()=>{
    if(!active)invalidate();
  },[progress,blocked,reducedMotion,size.width,size.height,active,invalidate]);
  useEffect(()=>{
    if(!active)return;
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
    let observedFrame=frames.current;
    const unsubscribe=addAfterEffect(()=>{
      // Global after-effects also run for other R3F roots. Only a completed frame
      // from this scene may schedule its next frame, with one timer outstanding.
      if(!alive||observedFrame===frames.current)return;
      observedFrame=frames.current;
      if(timer!==undefined)return;
      timer=setTimeout(()=>{
        timer=undefined;
        if(alive)invalidate();
      },24);
    });
    invalidate();
    return ()=>{
      alive=false;unsubscribe();
      if(timer!==undefined)clearTimeout(timer);
    };
  },[active,invalidate]);
  useEffect(()=>{
    // Visibility/pause gaps are not GPU cadence samples. Resolution never rises
    // during a mount, so this cannot oscillate or create a rerender feedback loop.
    quality.current.warmFrames=0;quality.current.samples=0;quality.current.seconds=0;
  },[active]);
  useEffect(()=>()=>{if(readyRaf.current!==null)cancelAnimationFrame(readyRaf.current);},[]);
  useFrame((_,delta)=>{
    const dt=Math.min(delta,.04);
    if(active) {
      time.current+=dt;
      const budget=quality.current;
      if(budget.warmFrames++>=2) {
        budget.samples++;budget.seconds+=delta;
        if(budget.samples===4) {
          const mean=budget.seconds/budget.samples;
          if(host.current)host.current.dataset.storyFrameMs=(mean*1000).toFixed(1);
          budget.samples=0;budget.seconds=0;
          if(mean>.08&&budget.changes<3&&viewport.dpr>.55) {
            const caps=[.85,.70,.55];
            // Sustained severe cadence takes the floor directly instead of
            // requiring three long sample windows on an already blocked device.
            const next=mean>.25?.55:caps[budget.changes];
            budget.changes++;
            budget.warmFrames=0;
            onDpr(Math.max(.55,Math.min(viewport.dpr,next)));
          }
        }
      }
    }
    const desired=reducedMotion?0:Math.max(0,Math.min(1,progress));
    actualProgress.current=active?actualProgress.current+(desired-actualProgress.current)*(1-Math.exp(-dt*11)):desired;
    const p=actualProgress.current;
    const scaled=p*5,index=Math.min(4,Math.floor(scaled));
    const raw=scaled-index,t=raw*raw*(3-2*raw);
    const cameraA=cameraPoses[index],cameraB=cameraPoses[index+1];
    const mobile=size.width<768;
    const wide=size.width/Math.max(1,size.height)>1.9;
    const px=active&&!reducedMotion?pointer.current.x:0,py=active&&!reducedMotion?pointer.current.y:0;
    pointerCurrent.current.x+=(px-pointerCurrent.current.x)*(active?1-Math.exp(-dt*5):1);
    pointerCurrent.current.y+=(py-pointerCurrent.current.y)*(active?1-Math.exp(-dt*5):1);
    sampleTriples(cameraA.position,cameraB.position,t,cameraPoint);
    sampleTriples(cameraA.target,cameraB.target,t,lookAt);
    if(mobile) {
      // Keep physical objects in the lower part of a portrait frame, beneath copy.
      const focalX=[.9,.45,1.05,0,1.8,1.75];
      lookAt.x=focalX[index]+(focalX[index+1]-focalX[index])*t;
      lookAt.y+=1.75;
      cameraDistance.subVectors(cameraPoint,lookAt);
      cameraPoint.copy(lookAt).addScaledVector(cameraDistance,1.15);
    }
    cameraPoint.x+=pointerCurrent.current.x*.24;
    cameraPoint.y+=pointerCurrent.current.y*.14;
    lookAt.x+=pointerCurrent.current.x*.1;
    camera.position.copy(cameraPoint);camera.lookAt(lookAt);
    if(camera instanceof PerspectiveCamera) {
      const fov=cameraA.fov+(cameraB.fov-cameraA.fov)*t+(mobile?17:wide?3:0);
      if(Math.abs(camera.fov-fov)>.001){camera.fov=fov;camera.updateProjectionMatrix();}
    }
    const idle=active&&!reducedMotion?Math.sin(time.current*.7)*.017:0;
    place(agent.current,agentPoses,index,t,point,idle);
    const blockedProgress=blocked?Math.min(p,.4):p;
    const blockedScaled=blockedProgress*5,cardIndex=Math.min(4,Math.floor(blockedScaled)),cardRaw=blockedScaled-cardIndex,cardT=cardRaw*cardRaw*(3-2*cardRaw);
    place(card.current,cardPoses,cardIndex,cardT,point,pointerCurrent.current.x*.07);
    if(card.current&&!reducedMotion)card.current.rotation.x+=pointerCurrent.current.y*.035;

    const gateEnter=smoothRange(p,.225,.345),gateExit=smoothRange(p,.47,.57);
    if(gate.current) {
      gate.current.visible=gateEnter>.001;
      gate.current.position.set(1.05,-.15-(1-gateEnter)*4.6-gateExit*3.7,-2.5);
      gate.current.rotation.y=.06;
    }
    const evidenceEnter=smoothRange(p,.43,.555),evidenceExit=smoothRange(p,.655,.745);
    if(evidence.current) {
      evidence.current.visible=evidenceEnter>.001;
      evidence.current.position.set(0,-(1-evidenceEnter)*4.8-evidenceExit*4.5,-4.2);
      evidence.current.rotation.y=-.2;
      evidence.current.scale.setScalar(blocked?.82:1);
    }
    const settlementEnter=smoothRange(p,.65,.755),settlementExit=smoothRange(p,.845,.96);
    if(settlement.current) {
      settlement.current.visible=settlementEnter>.001;
      settlement.current.position.set(1.15,-(1-settlementEnter)*4.7-settlementExit*4.7,-5.6);
      settlement.current.rotation.y=.15;
      settlement.current.scale.setScalar(.88);
    }
    const receiptEnter=smoothRange(p,.82,.955);
    if(receipt.current) {
      receipt.current.visible=receiptEnter>.001;
      receipt.current.position.set(3.05,-.68+receiptEnter*1.65,-4.83);
      receipt.current.rotation.set(-.07,.5,-.08);
      receipt.current.scale.setScalar(.95);
    }
    frames.current++;
    if(host.current) {
      host.current.dataset.storyFrame=String(frames.current);
      host.current.dataset.storyDpr=String(viewport.dpr);
      host.current.dataset.storyPose=String(Math.min(5,Math.round(p*5)));
    }
    if(!firstFrame.current) {
      firstFrame.current=true;
      // The following browser frame comes after this WebGL frame has rendered.
      readyRaf.current=requestAnimationFrame(()=>{readyRaf.current=null;onFirstFrame();});
    }
  });
  return <>
    <Studio/>
    <TerminalAgent ref={agent} progress={progress} active={active} reducedMotion={reducedMotion}/>
    <AgentCard ref={card}/>
    <TapeOutGate ref={gate} progress={progress} blocked={blocked}/>
    <EvidenceInstrument ref={evidence} progress={progress} blocked={blocked} active={active} reducedMotion={reducedMotion}/>
    <SettlementInstrument ref={settlement} progress={progress} blocked={blocked}/>
    <SettlementReceipt ref={receipt} blocked={blocked}/>
  </>;
}

function useMemoVector() {
  const value=useRef<Vector3|null>(null);
  if(!value.current)value.current=new Vector3();
  return value.current;
}

export default function StoryScene({progress,blocked,paused,reducedMotion,onReady,onError}:StorySceneProps) {
  const host=useRef<HTMLDivElement>(null),pointer=useRef({x:0,y:0}),intersecting=useRef(true),cleanupContext=useRef<(()=>void)|null>(null);
  const callbacks=useRef({onReady,onError}),notified=useRef(false),mounted=useRef(true);
  callbacks.current={onReady,onError};
  const [status,setStatus]=useState<"loading"|"ready"|"failed">("loading"),[visible,setVisible]=useState(true);
  const [dpr,setDpr]=useState(()=>typeof window==="undefined"?1:Math.max(.55,Math.min(1.35,window.devicePixelRatio||1)));
  const fail=useCallback((message:string)=>{
    if(!mounted.current||notified.current)return;
    notified.current=true;
    setStatus("failed");
    callbacks.current.onError?.(message);
  },[]);
  const ready=useCallback(()=>{
    if(!mounted.current||notified.current)return;
    setStatus("ready");
    callbacks.current.onReady?.();
  },[]);
  useEffect(()=>{
    mounted.current=true;
    const updateVisibility=()=>setVisible(!document.hidden&&intersecting.current);
    const observer=typeof IntersectionObserver!=="undefined"?new IntersectionObserver(entries=>{
      intersecting.current=entries[0]?.isIntersecting??true;updateVisibility();
    },{threshold:0}):null;
    if(host.current)observer?.observe(host.current);
    document.addEventListener("visibilitychange",updateVisibility);
    updateVisibility();
    return ()=>{
      mounted.current=false;observer?.disconnect();
      document.removeEventListener("visibilitychange",updateVisibility);
      cleanupContext.current?.();cleanupContext.current=null;
    };
  },[]);
  const active=!paused&&!reducedMotion&&visible&&status!=="failed";
  useEffect(()=>{
    if(!active)return;
    const move=(event:PointerEvent)=>{
      if(event.pointerType==="touch")return;
      pointer.current.x=Math.max(-1,Math.min(1,event.clientX/Math.max(1,window.innerWidth)*2-1));
      pointer.current.y=Math.max(-1,Math.min(1,1-event.clientY/Math.max(1,window.innerHeight)*2));
    };
    const leave=()=>{pointer.current={x:0,y:0};};
    window.addEventListener("pointermove",move,{passive:true});
    document.addEventListener("pointerleave",leave);
    return ()=>{window.removeEventListener("pointermove",move);document.removeEventListener("pointerleave",leave);};
  },[active]);
  function created(gl:WebGLRenderer) {
    gl.outputColorSpace=SRGBColorSpace;
    gl.toneMapping=ACESFilmicToneMapping;gl.toneMappingExposure=1.12;
    gl.setClearColor("#101716",0);
    const lost=(event:Event)=>{
      event.preventDefault();
      fail("The 3D scene lost its graphics context. The protocol story and film remain available.");
    };
    gl.domElement.addEventListener("webglcontextlost",lost,false);
    cleanupContext.current?.();
    cleanupContext.current=()=>gl.domElement.removeEventListener("webglcontextlost",lost,false);
  }
  return <div ref={host} data-story-renderer={status} data-story-frame="0" aria-hidden="true" style={{position:"absolute",inset:0,width:"100%",height:"100%",overflow:"hidden"}}>
    {status!=="failed"?<SceneBoundary onError={fail}>
      <Canvas shadows dpr={dpr} frameloop="demand" camera={{position:cameraPoses[0].position,fov:35,near:.1,far:70}} gl={{alpha:true,antialias:true,powerPreference:"high-performance",failIfMajorPerformanceCaveat:false}} onCreated={state=>created(state.gl)} fallback="The 3D scene requires WebGL. The protocol story and film remain available.">
        <Suspense fallback={null}>
          <Choreography progress={Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0))} blocked={blocked} active={active} reducedMotion={reducedMotion} host={host} pointer={pointer} onFirstFrame={ready} onDpr={setDpr}/>
        </Suspense>
      </Canvas>
    </SceneBoundary>:null}
  </div>;
}
