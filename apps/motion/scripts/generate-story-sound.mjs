import {mkdir,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const sampleRate=48000,duration=28,frames=sampleRate*duration;
const left=new Float64Array(frames),right=new Float64Array(frames);
const events=[
 {time:1.1,duration:.35,kind:"assemble",pan:-.4},
 {time:3.5,duration:.65,kind:"swipe",pan:-.35},
 {time:6.2,duration:.55,kind:"scan",pan:.45},
 {time:10.3,duration:.6,kind:"deny",pan:.25},
 {time:13.5,duration:.6,kind:"mechanism",pan:.1},
 {time:17.8,duration:.5,kind:"scan",pan:-.25},
 {time:18.4,duration:.15,kind:"compute",pan:-.5},
 {time:19,duration:.15,kind:"compute",pan:0},
 {time:19.6,duration:.15,kind:"compute",pan:.5},
 {time:20.2,duration:.45,kind:"seal",pan:.15},
 {time:23,duration:.65,kind:"mechanism",pan:.35},
 {time:25.2,duration:1.15,kind:"confirm",pan:.4}
];
let randomState=728491;
function random(){randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296*2-1}
function add(index,value,pan=0){const angle=(pan+1)*Math.PI/4;left[index]+=value*Math.cos(angle);right[index]+=value*Math.sin(angle)}
// Restrained original score: low chord field, slow harmonic movement, no sampled music.
const chords=[[73.4162,110,146.8324,220],[65.4064,98,130.8128,196],[82.4069,123.4708,164.8138,246.9416],[73.4162,110,146.8324,220]];
for(let n=0;n<frames;n++){
 const t=n/sampleRate;
 for(let ch=0;ch<4;ch++){
  const start=ch*7,end=start+8.3;
  if(t<start||t>end)continue;
  const local=t-start,fade=Math.min(1,local/1.5,(end-t)/1.3);
  const env=Math.max(0,fade)*.035;
  const notes=chords[ch];
  let voice=0;for(let k=0;k<notes.length;k++)voice+=Math.sin(2*Math.PI*notes[k]*t+Math.sin(t*.4)*.08)/(k+1);
  add(n,voice*env,Math.sin(t*.15)*.25);
 }
 // A sparse half-time machinery pulse follows the score; never frantic UI beeps.
 const beat=t%1.75;
 if(t>1&&t<25&&beat<.23)add(n,Math.sin(2*Math.PI*(47*beat+18*(1-Math.exp(-beat*20))))*.055*Math.exp(-beat*22),-.1);
}
for(const event of events){
 const start=Math.floor(event.time*sampleRate),length=Math.floor(event.duration*sampleRate);
 let filteredNoise=0;
 for(let i=0;i<length&&start+i<frames;i++){
  const t=i/sampleRate,p=t/event.duration,attack=Math.min(1,p/.06),release=Math.min(1,(1-p)/.14),envelope=attack*release;
  filteredNoise=filteredNoise*.72+random()*.28;
  let sample=0;
  if(event.kind==="swipe")sample=filteredNoise*.20*Math.sin(Math.PI*p)+Math.sin(2*Math.PI*(90*t+480*t*t))*.035*envelope;
  if(event.kind==="scan")sample=(Math.sin(2*Math.PI*(460*t+1100*t*t))*.075+Math.sin(2*Math.PI*92*t)*.035)*envelope;
  if(event.kind==="deny")sample=(Math.sin(2*Math.PI*138.59*t)+Math.sin(2*Math.PI*146.83*t))*.09*envelope*Math.exp(-p*2);
  if(event.kind==="mechanism")sample=(filteredNoise*.17+Math.sin(2*Math.PI*(95*t+45*t*t))*.095)*envelope;
  if(event.kind==="assemble")sample=(filteredNoise*.12+Math.sin(2*Math.PI*490*t)*.10)*Math.exp(-p*6)*attack;
  if(event.kind==="compute")sample=(Math.sin(2*Math.PI*880*t)+Math.sin(2*Math.PI*1320*t)*.25)*.08*attack*Math.exp(-p*5);
  if(event.kind==="seal")sample=(Math.sin(2*Math.PI*329.63*t)+Math.sin(2*Math.PI*493.88*t)*.55)*.07*envelope;
  if(event.kind==="confirm")sample=(Math.sin(2*Math.PI*440*t)+Math.sin(2*Math.PI*554.365*t)*.65+Math.sin(2*Math.PI*659.255*t)*.5)*.07*attack*Math.exp(-p*3);
  add(start+i,sample,event.pan);
 }
}
// Fixed linear fades and conservative mix headroom. No waveform exceeds -7dBFS.
let maximum=0;for(let n=0;n<frames;n++)maximum=Math.max(maximum,Math.abs(left[n]),Math.abs(right[n]));
const gain=.38/maximum;
const buffer=Buffer.alloc(44+frames*4);
buffer.write("RIFF",0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write("WAVEfmt ",8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*4,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write("data",36);buffer.writeUInt32LE(frames*4,40);
let energy=0,peak=0;
for(let n=0;n<frames;n++){
 const time=n/sampleRate,fade=Math.max(0,Math.min(1,time/.8,(duration-time)/1.2));
 const a=left[n]*gain*fade,b=right[n]*gain*fade;
 buffer.writeInt16LE(Math.round(a*32767),44+n*4);buffer.writeInt16LE(Math.round(b*32767),46+n*4);
 energy+=a*a+b*b;peak=Math.max(peak,Math.abs(a),Math.abs(b));
}
export const generatedSound=buffer;
export const soundEvents=events;
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
await mkdir(new URL("../public/",import.meta.url),{recursive:true});
await writeFile(new URL("../public/protocol-story-sound.wav",import.meta.url),buffer);
await writeFile(new URL("../public/protocol-story-sound-events.json",import.meta.url),JSON.stringify({original:true,sampleRate,channels:2,duration,events,peak,rms:Math.sqrt(energy/(frames*2))},null,2)+"\n");
console.log("Original story sound generated",JSON.stringify({seconds:duration,stereo:true,peak,rms:Math.sqrt(energy/(frames*2))}));

}
