import assert from "node:assert/strict";
import {stat,readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {generatedSound,soundEvents} from "../apps/motion/scripts/generate-story-sound.mjs";
const root=fileURLToPath(new URL("../",import.meta.url)),video=root+"apps/web/public/motion/protocol-story.mp4",poster=root+"apps/web/public/motion/protocol-story-poster.jpg";
function run(command,args,binary=false){const r=spawnSync(command,args,{encoding:binary?undefined:"utf8",timeout:60000,maxBuffer:12*1024*1024});assert.equal(r.status,0,String(r.stderr)||command+" failed");return r.stdout}
const info=JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",video]));
const vs=info.streams.find(s=>s.codec_type==="video"),audio=info.streams.find(s=>s.codec_type==="audio");
assert(vs&&audio,"Video and audio streams are both required");
assert.equal(vs.codec_name,"h264");assert.equal(vs.width,1920);assert.equal(vs.height,1080);assert.equal(vs.pix_fmt,"yuv420p");assert.equal(vs.avg_frame_rate,"30/1");assert.equal(Number(vs.nb_frames),840);
assert.equal(audio.codec_name,"aac");assert.equal(audio.channels,2);assert.equal(Number(audio.sample_rate),48000);
assert(Math.abs(Number(audio.start_time))<.05&&Math.abs(Number(vs.start_time))<.05,"Sound must start synchronized to picture");
const duration=Number(info.format.duration);assert(duration>=24&&duration<=32);assert(Math.abs(duration-28)<.05);
const size=(await stat(video)).size,p=(await stat(poster)).size;
assert(size>100000&&size<=8*1024*1024,"MP4 must fit the <=8MB story budget");assert(p>5000&&p<=300*1024,"Poster must fit <=300KB");
const pi=JSON.parse(run("ffprobe",["-v","error","-show_streams","-of","json",poster])).streams[0];
assert.equal(pi.width,1920);assert.equal(pi.height,1080);assert.equal(pi.codec_name,"mjpeg");
run("ffmpeg",["-hide_banner","-v","error","-xerror","-i",video,"-f","null","-"]);
const bytes=await readFile(video);assert(bytes.indexOf(Buffer.from("moov"))<bytes.indexOf(Buffer.from("mdat")),"Fast-start metadata required");
function pixels(time){const out=run("ffmpeg",["-hide_banner","-v","error","-ss",String(time),"-i",video,"-frames:v","1","-vf","scale=192:108:flags=area","-f","rawvideo","-pix_fmt","rgb24","-"],true);assert.equal(out.length,192*108*3);return out}
function diff(a,b){let value=0;for(let i=0;i<a.length;i++)value+=Math.abs(a[i]-b[i]);return value/a.length/255}
const sceneMotion=[
 ["intent",.8,3.8],["tap",5,6.5],["blocked",9,10.9],["reserved",12.3,14.6],["evidence",16,20.4],["settlement",21,23.7],["receipt",24.1,25.3]
].map(([name,a,b])=>({name,difference:diff(pixels(a),pixels(b))}));
for(const s of sceneMotion)assert(s.difference>.004,"Scene must visibly change: "+s.name);
const raw=run("ffmpeg",["-hide_banner","-v","error","-i",video,"-vn","-ar","48000","-ac","2","-f","s16le","-"],true);
const sampleCount=Math.min(raw.length,generatedSound.length-44)/2;
assert(Math.abs(raw.length/192000-28)<.05,"Complete sound track required");
let energy=0,peak=0,sourceEnergy=0,cross=0,differenceEnergy=0,stereoEnergy=0;
for(let i=0;i<sampleCount;i++){const a=raw.readInt16LE(i*2)/32768,b=generatedSound.readInt16LE(44+i*2)/32768;energy+=a*a;sourceEnergy+=b*b;cross+=a*b;differenceEnergy+=(a-b)**2;peak=Math.max(peak,Math.abs(a));if(i%2===0&&i+1<sampleCount)stereoEnergy+=(a-raw.readInt16LE((i+1)*2)/32768)**2}
const rms=Math.sqrt(energy/sampleCount),correlation=cross/Math.sqrt(energy*sourceEnergy),soundDifference=Math.sqrt(differenceEnergy/sampleCount);
assert(rms>.015&&rms<.15,"Sound should be audible at a moderate mix");assert(peak<.6,"No clipped or overly hot peaks");assert(Math.sqrt(stereoEnergy/(sampleCount/2))>.001,"Actual stereo mix required");
assert(correlation>.90&&soundDifference<.025,"Encoded soundtrack must stay synchronized to original source");
function windowRms(start,end){let sum=0,count=0;for(let n=Math.max(0,Math.floor(start*48000));n<Math.min(Math.floor(end*48000),raw.length/4);n++){for(let ch=0;ch<2;ch++){const v=raw.readInt16LE(n*4+ch*2)/32768;sum+=v*v;count++}}return Math.sqrt(sum/count)}
assert(windowRms(0,.1)<rms*.25&&windowRms(27.9,28)<rms*.25,"Clean opening and closing sound fades required");
const audibleEvents=soundEvents.map(e=>({kind:e.kind,time:e.time,rms:windowRms(e.time,e.time+e.duration)}));
for(const event of audibleEvents)assert(event.rms>.018,"Event is inaudible: "+event.kind);
console.log(JSON.stringify({duration,fps:vs.avg_frame_rate,videoBytes:size,posterBytes:p,decoded:true,stereo:true,audioRms:rms,audioPeak:peak,sourceCorrelation:correlation,soundDifference,sceneMotion,audibleEvents}));
console.log("Story motion verification passed");
