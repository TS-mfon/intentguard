import assert from "node:assert/strict";
import {stat, readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const video=root+"apps/web/public/motion/agent-card.mp4", poster=root+"apps/web/public/motion/agent-card-poster.jpg";
function run(command,args){const r=spawnSync(command,args,{encoding:"utf8",timeout:60000,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr||command+" failed");return r.stdout}
const info=JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",video]));
const vs=info.streams.find(s=>s.codec_type==="video");
assert(vs,"Video stream missing");assert.equal(vs.codec_name,"h264");assert.equal(vs.width,1280);assert.equal(vs.height,720);assert.equal(vs.pix_fmt,"yuv420p");assert.equal(vs.avg_frame_rate,"30/1");
assert(!info.streams.some(s=>s.codec_type==="audio"),"Background must be silent");
const duration=Number(info.format.duration);assert(duration>=8&&duration<=12,"Expected 8–12 second loop");
const size=(await stat(video)).size;assert(size>50000&&size<=5*1024*1024,"MP4 payload must fit <=5MB");
const p=(await stat(poster)).size;assert(p>5000&&p<=300*1024,"Poster payload must fit <=300KB");
const pi=JSON.parse(run("ffprobe",["-v","error","-show_streams","-of","json",poster])).streams[0];
assert.equal(pi.width,1280);assert.equal(pi.height,720);assert.equal(pi.codec_name,"mjpeg");
// Decode every frame, fail on actual corruption instead of trusting metadata alone.
run("ffmpeg",["-hide_banner","-v","error","-xerror","-i",video,"-f","null","-"]);
const bytes=await readFile(video);
assert(bytes.indexOf(Buffer.from("moov"))<bytes.indexOf(Buffer.from("mdat")),"MP4 must have fast-start metadata");

// Decode downsampled boundary/midpoint frames to confirm motion and a smooth loop seam.
function pixels(time){
 const r=spawnSync("ffmpeg",["-hide_banner","-v","error","-ss",String(time),"-i",video,"-frames:v","1","-vf","scale=160:90:flags=area","-f","rawvideo","-pix_fmt","rgb24","-"],{timeout:30000,maxBuffer:100000});
 assert.equal(r.status,0,String(r.stderr));assert.equal(r.stdout.length,160*90*3);return r.stdout;
}
function difference(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length/255}
const start=pixels(0),end=pixels(duration-.04),middle=pixels(duration/2);
const loopDifference=difference(start,end),motionDifference=difference(start,middle);
assert(loopDifference<.015,"Loop boundary visibly discontinuous");
assert(motionDifference>.0005&&motionDifference>loopDifference*2,"Expected actual motion beyond compression variation");

console.log(JSON.stringify({loopDifference,motionDifference,duration,fps:vs.avg_frame_rate,width:vs.width,height:vs.height,videoBytes:size,posterBytes:p,silent:true,decoded:true}));
console.log("Motion verification passed");
