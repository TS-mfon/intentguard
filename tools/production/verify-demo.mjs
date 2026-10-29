/** Independent artifact verification; missing film or unverifiable records fails. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,output,sha,run,sourceFiles,validateCaptured,verifyPublicReceipts,verifyCardTerms,scenesFor,narrationFor} from '../../apps/motion/scripts/submission-demo.mjs';

const json=async file=>JSON.parse(await readFile(file,'utf8'));
const auditFile=join(root,'docs/audits/cctp-independent.json');
const audit=await json(auditFile),capture=await json(join(output,'capture.json')),props=await json(join(output,'props.json')),artifact=await json(join(output,'artifact.json'));
validateCaptured(audit,capture);
// A negative oracle must reject a known false delivery, and a valid control must pass.
const bad=structuredClone(capture);bad.records[0].body.transaction.amount='10';assert.throws(()=>validateCaptured(audit,bad));
const wrong=structuredClone(capture);wrong.config.paymentEnvironment='mainnet';assert.throws(()=>validateCaptured(audit,wrong));
const unverified=structuredClone(capture);unverified.records[0].body.reasoningSource='unavailable';assert.throws(()=>validateCaptured(audit,unverified));
const invalidTime=structuredClone(capture);invalidTime.records[0].body.transaction.updatedAt=invalidTime.records[0].body.transaction.createdAt-1;assert.throws(()=>validateCaptured(audit,invalidTime));
for(const [field,value]of [['token','0x'+ '1'.repeat(40)],['destinationChainId',1],['destinationToken','0x'+ '1'.repeat(40)],['paymentTxHash','0x'+'1'.repeat(64)]]){const wrong=structuredClone(capture);wrong.records[0].body.transaction[field]=value;assert.throws(()=>validateCaptured(audit,wrong));}
const forgedBridge=structuredClone(capture);forgedBridge.records[1].body.transaction.bridge.destinationTxHash='0x'+'1'.repeat(64);assert.throws(()=>validateCaptured(audit,forgedBridge));
validateCaptured(audit,capture);
assert.equal(capture.auditSha256,sha(await readFile(auditFile)));
for(const file of sourceFiles){const current=await readFile(join(root,file));assert.equal(capture.sources[file],sha(current),`Source changed after capture: ${file}`);const committed=spawnSync('git',['show',`${capture.sourceCommit}:${file}`],{cwd:root,maxBuffer:10*1024*1024});assert.equal(committed.status,0);assert.equal(sha(committed.stdout),sha(current),'Capture must bind committed source');}
assert.equal(artifact.kind,'EXPORTED_VERIFIED_RECORD_SUBMISSION');assert.equal(artifact.sourceCommit,capture.sourceCommit);assert.equal(artifact.captureSha256,sha(await readFile(join(output,'capture.json'))));assert.equal(artifact.propsSha256,sha(await readFile(join(output,'props.json'))));assert.equal(artifact.transcriptSha256,sha(await readFile(join(output,'transcript.json'))));
assert.deepEqual(props.scenes,scenesFor(capture,audit));assert.deepEqual(await json(join(output,'transcript.json')),narrationFor(props.scenes));assert.equal(props.sourceCommit,capture.sourceCommit);assert.equal(props.origin,capture.origin);assert.equal(props.hostedCommit,capture.config.sourceCommit);
for(const row of capture.records){const image=Buffer.from(row.image.split(',')[1],'base64');assert.equal(sha(image),row.screenshotSha256);assert.equal(sha(await readFile(join(output,row.name+'.png'))),row.screenshotSha256);assert.equal(image.readUInt32BE(16),1200);assert.equal(image.readUInt32BE(20),850);}
const film=join(output,'intentguard-submission.mp4');assert.equal(artifact.file,'.local/submission-video/intentguard-submission.mp4');assert.equal(artifact.sha256,sha(await readFile(film)));
const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',film]));const duration=Number(probe.format.duration);assert.ok(duration>0&&duration<=180);assert.ok(Math.abs(duration-artifact.durationSeconds)<0.2);assert.equal(artifact.durationSeconds,170);
const video=probe.streams.filter(row=>row.codec_type==='video'),audio=probe.streams.filter(row=>row.codec_type==='audio');assert.equal(video.length,1);assert.equal(audio.length,1);assert.equal(video[0].codec_name,'h264');assert.equal(video[0].width,1920);assert.equal(video[0].height,1080);assert.equal(video[0].pix_fmt,'yuv420p');assert.equal(audio[0].codec_name,'aac');assert.ok(Number(audio[0].duration)>169);
run('ffmpeg',['-v','error','-i',film,'-f','null','-']);
const volume=spawnSync('ffmpeg',['-hide_banner','-i',film,'-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8',maxBuffer:1024*1024});assert.equal(volume.status,0);const mean=Number(volume.stderr.match(/mean_volume: ([\d.-]+) dB/)?.[1]);assert.ok(mean>-35&&mean<0,'Narration stream must contain audible audio, not silence');
const receipts=await verifyPublicReceipts(audit);assert.equal(receipts.length,2);const mandateProof=await verifyCardTerms(capture,audit);const {verifiedAt:oldTime,...oldTerms}=capture.mandateProof,{verifiedAt:newTime,...currentTerms}=mandateProof;assert.deepEqual(currentTerms,oldTerms);
await mkdir(join(output,'frames'),{recursive:true});let start=0;const frames=[];for(const scene of props.scenes){const time=start+scene.seconds/2,file=join(output,'frames',scene.key+'.jpg');run('ffmpeg',['-v','error','-y','-ss',String(time),'-i',film,'-frames:v','1','-q:v','2',file]);frames.push({scene:scene.key,timeSeconds:time,sha256:sha(await readFile(file))});start+=scene.seconds;}
const report={version:1,kind:'INDEPENDENT_EXPORTED_SUBMISSION_CHECK',verifiedAt:new Date().toISOString(),sourceCommit:capture.sourceCommit,hostedOrigin:capture.origin,capturedAt:capture.capturedAt,artifactSha256:artifact.sha256,durationSeconds:duration,video:{codec:video[0].codec_name,width:1920,height:1080},audio:{codec:audio[0].codec_name,meanVolumeDb:mean,narration:artifact.narration},records:capture.records.map(row=>({name:row.name,requestId:row.body.transaction.id,status:row.body.transaction.status,amount:row.body.transaction.amount,publicUrl:row.pageUrl,reasoningSource:row.body.reasoningSource})),receipts,frames,manualFrameReview:'Required independently; runnable checks do not prove legibility or editorial truth',limitations:['Historical testnet records; no monetary value','Original 10/12 audit unresolved; 8/8 does not replace it','Official mainnet TapeOut/DeWEB and full acceptance pending','No customer/pilot or implemented pricing evidence claimed']};
await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log('SUBMISSION_VIDEO_VERIFIED');
