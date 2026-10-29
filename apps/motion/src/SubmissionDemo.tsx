import {AbsoluteFill, Composition, Img, Sequence, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame} from "remotion";
import {Audio} from "@remotion/media";
import {useEffect, useState} from "react";

export type SubmissionScene={key:string;seconds:number;title:string;caption:string;facts:string[];image?:string;recordId?:string};
export type SubmissionProps={capturedAt:string;sourceCommit:string;hostedCommit:string;origin:string;scenes:SubmissionScene[];narration:string};

function EvidenceScene({scene,index,total}:{scene:SubmissionScene;index:number;total:number}){
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:"#101716",color:"#f5f0e5",fontFamily:"Plex, sans-serif",padding:"36px 80px 40px",boxSizing:"border-box",opacity:interpolate(frame,[0,12],[0,1],{extrapolateRight:"clamp"})}}>
  <div style={{display:"flex",justifyContent:"space-between",fontSize:26,color:"#c9d1ca",letterSpacing:1}}>INTENTGUARD <span>REAL HISTORICAL TESTNET RECORDS · TOKENS HAVE NO MONETARY VALUE</span></div>
  <h1 style={{fontSize:64,lineHeight:1.06,fontWeight:600,margin:"24px 0 26px",letterSpacing:-2}}>{scene.title}</h1>
  <div style={{display:"flex",gap:34,height:632}}>
   {scene.image?<div style={{width:1080,height:632,background:"#f5f0e5",borderRadius:12,overflow:"hidden",flexShrink:0}}><Img src={scene.image} style={{width:"100%",height:"100%",objectFit:"contain"}}/></div>:null}
   <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:28,padding:scene.image?"10px 0":"36px 60px",border:scene.image?undefined:"1px solid #4b5751",borderRadius:12}}>
    {scene.facts.map((fact,i)=><p key={i} style={{fontSize:scene.image?34:44,lineHeight:1.32,margin:0,color:i===0?"#b8e69d":"#f5f0e5"}}>{fact}</p>)}
   </div>
  </div>
  <p style={{fontSize:30,lineHeight:1.3,margin:"22px 0 14px",color:"#d5dcd3",maxWidth:1680}}>{scene.caption}</p>
  {scene.recordId?<div style={{fontFamily:"Plex Mono, monospace",fontSize:22,color:"#b8c4b8"}}>PUBLIC REQUEST {scene.recordId}</div>:null}
  <div style={{position:"absolute",bottom:24,left:80,right:80,display:"flex",justifyContent:"space-between",fontSize:21,color:"#8da194"}}><span>Studionet testnet review · offchain API/worker · configured attestor trust</span><span>{String(index+1).padStart(2,"0")} / {total}</span></div>
 </AbsoluteFill>;
}

export function SubmissionDemo({scenes,narration}:SubmissionProps){
 const [fontHandle]=useState(()=>delayRender("Verified submission IBM Plex fonts"));
 useEffect(()=>{
  const sans=new FontFace("Plex","url("+staticFile("fonts/plex-sans.woff2")+")",{weight:"500"});
  const mono=new FontFace("Plex Mono","url("+staticFile("fonts/plex-mono.woff2")+")",{weight:"400"});
  Promise.all([sans.load(),mono.load()]).then(fonts=>{fonts.forEach(font=>document.fonts.add(font));continueRender(fontHandle)}).catch(cancelRender);
 },[fontHandle]);
 if(!scenes.length||!narration)throw Error("SubmissionDemo requires verified captured evidence and narration. Run submission-demo.mjs capture/render.");
 if(scenes.some(scene=>!Number.isInteger(scene.seconds)||scene.seconds<=0)||scenes.reduce((sum,scene)=>sum+scene.seconds,0)>180)throw Error("SubmissionDemo requires positive whole-second scenes totalling at most three minutes.");
 if(new Set(scenes.map(scene=>scene.key)).size!==scenes.length)throw Error("SubmissionDemo scene identifiers must be unique.");
 let start=0;
 return <AbsoluteFill>{narration?<Audio src={narration}/>:null}{scenes.map((scene,index)=>{const from=start;start+=scene.seconds*30;return <Sequence key={scene.key} from={from} durationInFrames={scene.seconds*30}><EvidenceScene scene={scene} index={index} total={scenes.length}/></Sequence>})}</AbsoluteFill>;
}

export const SubmissionComposition=()=> <Composition id="SubmissionDemo" component={SubmissionDemo} width={1920} height={1080} fps={30} durationInFrames={5100} defaultProps={{capturedAt:"",sourceCommit:"",hostedCommit:"",origin:"",scenes:[],narration:""}} calculateMetadata={({props})=>({durationInFrames:props.scenes.length?props.scenes.reduce((sum,scene)=>sum+scene.seconds*30,0):5100})}/>;
