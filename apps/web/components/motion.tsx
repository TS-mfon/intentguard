"use client";
import {useEffect,useRef,useState,type ReactNode,type CSSProperties} from "react";
import {Pause,Play} from "lucide-react";

export function Reveal({children,className="",delay=0}:{children:ReactNode;className?:string;delay?:number}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=ref.current;
    if(!element||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)){
        element.animate([{opacity:.45,transform:"translateY(24px)"},{opacity:1,transform:"translateY(0)"}],{duration:500,delay,easing:"cubic-bezier(.16,1,.3,1)",fill:"none"});
        observer.disconnect();
      }
    },{threshold:.1});
    observer.observe(element);
    return()=>observer.disconnect();
  },[delay]);
  return <div ref={ref} className={className}>{children}</div>;
}

export function AgentFilm() {
  const video=useRef<HTMLVideoElement>(null),stage=useRef<HTMLDivElement>(null);
  const[paused,setPaused]=useState(false),[reduced,setReduced]=useState(true),[failed,setFailed]=useState(false);
  const visible=useRef(true),userPaused=useRef(false);
  const sync=()=>{
    const media=video.current;if(!media)return;
    if(userPaused.current||!visible.current||document.hidden||matchMedia("(prefers-reduced-motion: reduce)").matches)media.pause();
    else void media.play().catch(()=>{setFailed(true)});
  };
  useEffect(()=>{
    const query=matchMedia("(prefers-reduced-motion: reduce)");
    let saved=false;try{saved=localStorage.getItem("intentguard-motion-paused")==="true"}catch{}
    userPaused.current=saved;setPaused(saved);setReduced(query.matches);
    const change=()=>{setReduced(query.matches);sync()};
    const visibility=()=>sync();
    const observer=new IntersectionObserver(entries=>{visible.current=entries[0]?.isIntersecting??false;sync()},{threshold:.05});
    if(stage.current)observer.observe(stage.current);
    query.addEventListener("change",change);document.addEventListener("visibilitychange",visibility);sync();
    return()=>{observer.disconnect();query.removeEventListener("change",change);document.removeEventListener("visibilitychange",visibility);video.current?.pause()};
  },[]);
  function toggle(){
    userPaused.current=!userPaused.current;setPaused(userPaused.current);
    try{localStorage.setItem("intentguard-motion-paused",String(userPaused.current))}catch{}
    sync();
  }
  return <div className={"agent-film "+(reduced?"film-static":"")} ref={stage}>
    <video ref={video} muted loop playsInline preload="metadata" poster="/motion/agent-card-poster.jpg" aria-hidden="true" onError={()=>setFailed(true)} onCanPlay={sync}>
      <source src="/motion/agent-card.mp4" type="video/mp4"/>
    </video>
    <div className="film-vignette" aria-hidden="true"/>
    {!reduced&&!failed?<button type="button" className="motion-toggle" onClick={toggle} aria-pressed={paused} aria-label={paused?"Play background animation":"Pause background animation"}>{paused?<Play size={16}/>:<Pause size={16}/>}<span>{paused?"Play motion":"Pause motion"}</span></button>:null}
  </div>;
}

export function CardTilt({children}:{children:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);
 function move(event:React.PointerEvent<HTMLDivElement>){
  if(event.pointerType!=="mouse"||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const element=ref.current;if(!element)return;
  const box=element.getBoundingClientRect(),x=(event.clientX-box.left)/box.width-.5,y=(event.clientY-box.top)/box.height-.5;
  element.style.transform="perspective(1200px) rotateX("+(-y*4)+"deg) rotateY("+(x*4)+"deg)";
 }
 return <div ref={ref} className="card-tilt" onPointerMove={move} onPointerLeave={()=>{if(ref.current)ref.current.style.transform=""}}>{children}</div>;
}
