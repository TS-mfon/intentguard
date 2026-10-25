import {AbsoluteFill, Composition, delayRender,continueRender,staticFile} from "remotion";
import {Audio} from "@remotion/media";
import {TransitionSeries,linearTiming} from "@remotion/transitions";
import {fade} from "@remotion/transitions/fade";
import {useEffect,useState} from "react";
import {IntentScene} from "./story/Intent";
import {TapScene} from "./story/Tap";
import {BlockedScene} from "./story/Blocked";
import {ReservedScene} from "./story/Reserved";
import {EvidenceScene} from "./story/Evidence";
import {SettlementScene} from "./story/Settlement";
import {ReceiptScene} from "./story/Receipt";

function ProtocolStoryFilm(){
 const [handle]=useState(()=>delayRender("Local IBM Plex film fonts"));
 useEffect(()=>{
  const sans=new FontFace("Plex","url("+staticFile("fonts/plex-sans.woff2")+")",{weight:"500"});
  const mono=new FontFace("Plex Mono","url("+staticFile("fonts/plex-mono.woff2")+")",{weight:"400"});
  Promise.all([sans.load(),mono.load()]).then(fonts=>{fonts.forEach(font=>document.fonts.add(font));continueRender(handle)}).catch(()=>continueRender(handle));
 },[handle]);
 return <AbsoluteFill style={{background:"#101716"}}>
 <Audio src={staticFile("protocol-story-sound.wav")}/>
 <TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={150}><IntentScene/></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:10})}/>
  <TransitionSeries.Sequence durationInFrames={120}><TapScene/></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:10})}/>
  <TransitionSeries.Sequence durationInFrames={120}><BlockedScene/></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:10})}/>
  <TransitionSeries.Sequence durationInFrames={120}><ReservedScene/></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:10})}/>
  <TransitionSeries.Sequence durationInFrames={150}><EvidenceScene/></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:10})}/>
  <TransitionSeries.Sequence durationInFrames={120}><SettlementScene/></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:10})}/>
  <TransitionSeries.Sequence durationInFrames={120}><ReceiptScene/></TransitionSeries.Sequence>
 </TransitionSeries>
 </AbsoluteFill>;
}
export const StoryComposition=()=> <Composition id="ProtocolStory" component={ProtocolStoryFilm} durationInFrames={840} fps={30} width={1920} height={1080}/>;
