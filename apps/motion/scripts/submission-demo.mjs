/** Capture public evidence, then render the submission. Never intercept API data. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setDefaultResultOrder} from 'node:dns';
import {chromium} from '@playwright/test';
import {createPublicClient,http,parseAbi,decodeEventLog,parseUnits} from 'viem';
import {CCTP_TESTNETS} from '../../../packages/shared/assets.ts';
setDefaultResultOrder('ipv4first');

export const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
export const output=join(root,'.local/submission-video');
export const sourceFiles=['apps/motion/src/SubmissionDemo.tsx','apps/motion/src/Root.tsx','apps/motion/src/index.ts','apps/motion/scripts/submission-demo.mjs','tools/production/verify-demo.mjs','apps/motion/package.json','apps/motion/package-lock.json','apps/motion/remotion.config.ts','apps/motion/public/fonts/plex-sans.woff2','apps/motion/public/fonts/plex-mono.woff2','packages/shared/assets.ts','package.json','pnpm-lock.yaml'];
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const run=(binary,args,cwd=root)=>{const result=spawnSync(binary,args,{cwd,encoding:'utf8',maxBuffer:20*1024*1024});if(result.status!==0)throw Error(`${binary} failed: ${String(result.stderr).slice(-1800)}`);return result.stdout;};
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
const fetchJson=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(90000),redirect:'error',headers:{'X-IntentGuard-Environment':'testnet'}});assert.equal(response.status,200,`Public evidence unavailable: ${url} HTTP ${response.status}`);return response.json();};
const required=['xlayer','base','limit','prohibited','evidence'];
const transferAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const zero='0x0000000000000000000000000000000000000000';
const lower=value=>String(value).toLowerCase();
const sameHex=(actual,expected,label)=>assert.equal(lower(actual),lower(expected),label);
const publicTerms=agent=>({id:agent.id,address:lower(agent.address),policyHash:agent.policyHash,mission:agent.mission,financial:agent.financial});
export async function verifyCardTerms(capture,audit){
 const agent=capture.records[0].body.agent,client=createPublicClient({transport:http(CCTP_TESTNETS[1952].rpcUrl,{timeout:30000,retryCount:1})});assert.equal(await client.getChainId(),1952);
 const read=(name,type)=>client.readContract({address:audit.cardAddress,abi:parseAbi([`function ${name}() view returns (${type})`]),functionName:name});
 sameHex(await read('policyHash','bytes32'),agent.policyHash,'Public mandate policy hash must match the immutable vault');sameHex(await read('token','address'),CCTP_TESTNETS[1952].token);
 const getters=[['totalLimit','totalBudget'],['perPaymentLimit','perPaymentLimit'],['periodLimit','periodBudget'],['periodSeconds','periodSeconds'],['validFrom','validFrom'],['validUntil','validUntil']];
 for(const [getter,field]of getters){const value=await read(getter,'uint64');assert.equal(value,['totalBudget','perPaymentLimit','periodBudget'].includes(field)?parseUnits(agent.financial[field],6):BigInt(agent.financial[field]),'Public terms differ from immutable '+getter);}
 const abi=parseAbi(['function getRequest(bytes32 id) view returns ((bytes32 requestHash,bytes32 evidenceHash,bytes32 invoiceKey,address recipient,uint64 amount,uint64 expiresAt,uint64 periodId,uint8 status))']);
 const requests=[];for(const name of required){const expected=audit.cases.find(row=>row.name===name),state=await client.readContract({address:audit.cardAddress,abi,functionName:'getRequest',args:[expected.requestId]});assert.equal(Number(state.status),expected.onchainStatus);if(expected.decision){sameHex(state.requestHash,expected.decision.requestHash);sameHex(state.evidenceHash,expected.decision.evidenceHash);sameHex(state.recipient,audit.merchant);assert.equal(state.amount,parseUnits(expected.amount,6));}requests.push({name,requestId:expected.requestId,status:Number(state.status)});}
 return {verifiedAt:new Date().toISOString(),...publicTerms(agent),requests};
}
function exactTransfer(receipt,token,from,to,value){const logs=receipt.logs.filter(log=>lower(log.address)===lower(token)).flatMap(log=>{try{return [decodeEventLog({abi:transferAbi,data:log.data,topics:log.topics})]}catch{return []}});assert.equal(logs.filter(log=>lower(log.args.from)===lower(from)&&lower(log.args.to)===lower(to)&&log.args.value===value).length,1,'Receipt must contain exactly one issuer-token transfer matching the displayed amount and recipient');}
export async function verifyPublicReceipts(audit){
 const evidence=[];
 for(const name of ['xlayer','base']){
  const entry=audit.cases.find(row=>row.name===name);assert.equal(entry.verified,true);assert.equal(entry.status,'PAID');
  const destination=CCTP_TESTNETS[entry.destinationChainId],client=createPublicClient({transport:http(destination.rpcUrl,{timeout:30000,retryCount:1})});
  assert.equal(await client.getChainId(),destination.chainId);
  const tx=entry.destinationTxHash??entry.paymentTxHash,receipt=await client.getTransactionReceipt({hash:tx});assert.equal(receipt.status,'success');
  const block=await client.getBlock({blockNumber:receipt.blockNumber});assert.equal(block.hash,receipt.blockHash);assert.ok(await client.getBlockNumber()>receipt.blockNumber+2n);
  exactTransfer(receipt,destination.token,name==='xlayer'?audit.cardAddress:zero,audit.merchant,parseUnits(entry.amount,6));
  const row={name,chainId:destination.chainId,txHash:tx,blockHash:receipt.blockHash,blockNumber:String(receipt.blockNumber),amount:entry.amount,recipient:audit.merchant,token:destination.token,verifiedAt:new Date().toISOString()};
  if(name==='base'){
   const source=CCTP_TESTNETS[1952],sourceClient=createPublicClient({transport:http(source.rpcUrl,{timeout:30000,retryCount:1})});assert.equal(await sourceClient.getChainId(),1952);
   const burn=await sourceClient.getTransactionReceipt({hash:entry.sourceTxHash}),ack=await sourceClient.getTransactionReceipt({hash:entry.confirmationTxHash});assert.equal(burn.status,'success');assert.equal(ack.status,'success');
   for(const receipt of [burn,ack]){const block=await sourceClient.getBlock({blockNumber:receipt.blockNumber});assert.equal(block.hash,receipt.blockHash,'Source receipt must remain in its canonical block');assert.ok(await sourceClient.getBlockNumber()>receipt.blockNumber+2n,'Source receipt requires confirmed finality');}
   exactTransfer(burn,source.token,audit.cardAddress,source.minter,parseUnits(entry.amount,6));
   const bridge=decodeEventLog({abi:parseAbi(['event BridgePaid(bytes32 indexed requestId,bytes32 sourceTxHash,bytes32 destinationTxHash,bytes32 messageHash,address recipient,uint64 amount)']),...ack.logs.find(log=>{try{return lower(log.address)===lower(audit.cardAddress)&&decodeEventLog({abi:parseAbi(['event BridgePaid(bytes32 indexed requestId,bytes32 sourceTxHash,bytes32 destinationTxHash,bytes32 messageHash,address recipient,uint64 amount)']),data:log.data,topics:log.topics}).args.requestId===entry.requestId}catch{return false}})});
   assert.equal(lower(bridge.args.sourceTxHash),lower(entry.sourceTxHash));assert.equal(lower(bridge.args.destinationTxHash),lower(tx));assert.equal(lower(bridge.args.recipient),lower(audit.merchant));assert.equal(bridge.args.amount,parseUnits(entry.amount,6));
   row.sourceTxHash=entry.sourceTxHash;row.confirmationTxHash=entry.confirmationTxHash;
  }
  evidence.push(row);
 }
 return evidence;
}
export function validateCaptured(audit,capture){
 assert.equal(capture.kind,'ACTUAL_HOSTED_TESTNET_CAPTURE');assert.match(capture.origin,/^https:\/\//);assert.match(capture.sourceCommit,/^[0-9a-f]{40}$/);assert.equal(capture.config.sourceCommit,capture.sourceCommit);assert.equal(capture.config.chainId,1952);assert.equal(capture.config.paymentEnvironment,'testnet');
 assert.deepEqual(capture.records.map(row=>row.name),required);
 for(const row of capture.records){
  const expected=audit.cases.find(entry=>entry.name===row.name),tx=row.body.transaction,agent=row.body.agent,destination=CCTP_TESTNETS[expected.destinationChainId];
  assert.equal(tx.id,expected.requestId);assert.equal(tx.cardId,audit.cardId);assert.equal(tx.status,expected.status);assert.equal(tx.amount,expected.amount);sameHex(tx.recipient,audit.merchant);assert.equal(tx.chainId,1952);sameHex(tx.token,CCTP_TESTNETS[1952].token);assert.equal(tx.destinationChainId,expected.destinationChainId);sameHex(tx.destinationToken,destination.token);assert.equal(tx.paymentEnvironment,'testnet');assert.equal(tx.reviewNetwork,'studionet');assert.equal(tx.reviewChainId,61999);
  assert.ok(Number.isSafeInteger(tx.createdAt)&&tx.createdAt>0&&Number.isSafeInteger(tx.updatedAt)&&tx.updatedAt>=tx.createdAt,'Displayed operation latency requires chronological measured timestamps');
  assert.equal(agent.id,audit.cardId);sameHex(agent.address,audit.cardAddress);sameHex(agent.token,CCTP_TESTNETS[1952].token);assert.equal(agent.mission,'Verify IntentGuard native testnet USDC payment settlement to the approved protocol test merchant on X Layer, Base Sepolia and Arbitrum Sepolia.');sameHex(agent.policyHash,audit.cases.find(entry=>entry.name==='xlayer').decision.policyHash);assert.deepEqual(publicTerms(agent),publicTerms(capture.records[0].body.agent),'Every frame must reference the same public mandate and exact terms');
  if(['xlayer','base','prohibited'].includes(row.name)){assert.equal(row.body.reasoningSource,'genlayer-finalized-contract','Film requires independently verified finalized reasoning at capture time');assert.equal(row.body.reviewStage.status,'COMPLETE');sameHex(tx.genLayerTxHash,expected.genLayerTxHash);sameHex(tx.requestHash,expected.decision.requestHash);sameHex(tx.evidenceHash,expected.decision.evidenceHash);sameHex(tx.review.policyHash,agent.policyHash);assert.equal(tx.review.decision,expected.decision.decision);}else{assert.equal(row.body.reviewStage.status,'SKIPPED');assert.equal(tx.genLayerTxHash,undefined);}
  if(expected.status==='PAID')sameHex(tx.paymentTxHash,expected.destinationTxHash??expected.paymentTxHash,'Displayed payment receipt must be independently verified');else{assert.equal(tx.paymentTxHash,undefined);assert.equal(tx.bridge,undefined);}
  if(row.name==='base'){const bridge=tx.bridge;assert.equal(bridge.protocol,'CCTP_V2');assert.equal(bridge.phase,'CONFIRMED');assert.equal(bridge.sourceChainId,1952);assert.equal(bridge.destinationChainId,expected.destinationChainId);assert.equal(bridge.destinationDomain,destination.domain);sameHex(bridge.sourceToken,CCTP_TESTNETS[1952].token);sameHex(bridge.destinationToken,destination.token);assert.equal(bridge.amount,expected.amount);sameHex(bridge.sourceTxHash,expected.sourceTxHash);sameHex(bridge.destinationTxHash,expected.destinationTxHash);sameHex(bridge.confirmationTxHash,expected.confirmationTxHash);sameHex(bridge.nonce,expected.nonce);}
  assert.equal(row.apiUrl,capture.origin+'/api/v1/explorer/transactions/'+expected.requestId);assert.equal(row.pageUrl,capture.origin+'/transaction?id='+expected.requestId);
  for(const [hash,chainId]of (row.name==='base'?[[expected.sourceTxHash,1952],[expected.destinationTxHash,expected.destinationChainId],[expected.confirmationTxHash,1952]]:expected.status==='PAID'?[[expected.paymentTxHash,1952]]:[])){
   const url=row.receiptLinks.find(url=>lower(new URL(url).pathname).endsWith('/tx/'+lower(hash)));assert.ok(url,'Hosted screenshot must expose the actual verified receipt link');assert.equal(new URL(url).protocol,'https:');assert.ok([new URL(CCTP_TESTNETS[chainId].explorerUrl).host,...(chainId===1952?['www.oklink.com']:[])].includes(new URL(url).host),'Receipt link must use the corresponding verified chain explorer');
  }
 }
 assert.equal(audit.cases.find(row=>row.name==='idempotent').requestId,capture.records[0].body.transaction.id,'Replay must cite the archived same-operation proof');
}
export function scenesFor(capture,audit){
 const record=name=>capture.records.find(row=>row.name===name),facts=name=>{const row=record(name),tx=row.body.transaction;return [`${tx.amount} USDC · ${tx.status}`,`Destination: ${CCTP_TESTNETS[tx.destinationChainId]?.name??CCTP_TESTNETS[tx.bridge?.destinationChainId]?.name}`,`Review: ${row.body.reviewStage.status}`,`Elapsed: ${((tx.updatedAt-tx.createdAt)/1000).toFixed(1)} seconds`];};
 const scene=(key,seconds,title,caption,details,recordName)=>({key,seconds,title,caption,facts:details,...(recordName?{recordId:record(recordName).body.transaction.id,image:record(recordName).image}: {})});
 return [
  scene('intro',18,'A card with boundaries.','Captured from the public hosted product. These historical testnet records include delivered payments and unpaid attempts.', ['An owner sets a bounded budget and an allowed purpose.','Every request needs numerical permission and evidence review.','No wallet is needed to inspect these real records.'],'xlayer'),
  scene('mandate',22,'The owner defines the permission.','The public mandate and exact limits come from the deployed testnet card. Owner setup and controls are outside this recording.',[`Mission: ${record('xlayer').body.agent.mission}`,`Lifetime limit: ${record('xlayer').body.agent.financial.totalBudget} USDC`, `Per payment: ${record('xlayer').body.agent.financial.perPaymentLimit} USDC`,`Period: ${record('xlayer').body.agent.financial.periodBudget} USDC / ${record('xlayer').body.agent.financial.periodSeconds} seconds`]),
  scene('direct',22,'PAID means delivered.','The native issuer USDC receipt was refetched independently. Approval and HTTP 202 are separate from a transfer.',facts('xlayer'),'xlayer'),
  scene('bridge',24,'One burn. One delivery.','Historical X Layer to Base Sepolia delivery. Source burn, destination mint and source acknowledgement are separately verified.',facts('base'),'base'),
  scene('block',14,'Budget exceeded. Review skipped.','The excessive request ended before a reservation or transfer. This is an attempt, not funds moved.',facts('limit'),'limit'),
  scene('reject',14,'A prohibited purpose is rejected.','Finalized GenLayer reasoning rejected this purchase of personal advertising data. No payment completed.',facts('prohibited'),'prohibited'),
  scene('evidence',12,'Wrong buyer. No authorization.','The evidence did not identify this vault as buyer. The operation requires evidence and review was skipped.',facts('evidence'),'evidence'),
  scene('replay',12,'A retry preserves one purchase.','Archived October 26 testnet replay evidence references the exact same request. This film does not submit a new replay.',[`Archived idempotent check: ${audit.cases.find(row=>row.name==='idempotent').verified?'verified':'unverified'}`,'One stable Idempotency-Key binds an unchanged request.','Changed payloads must conflict; retries do not authorize another payment.'],'xlayer'),
  scene('commercial',12,'A pricing hypothesis to test.','No customer interviews or recurring pilots are claimed. Measured historical operation times are shown; cost accounting remains incomplete.',['Target: teams buying research and API access repeatedly.','USD 49 / team / month is unvalidated.','A possible 10 basis point fee is unvalidated and unimplemented.','Actual demand, retention and willingness to pay remain required.']),
  scene('provenance',20,'Evidence, with the limits visible.','This records the testnet release. Original 10/12 semantic audit remains unresolved. The later 8/8 audit does not replace it.',[`Captured: ${capture.capturedAt}`,`Hosted source: ${capture.sourceCommit.slice(0,16)}`,'Existing adapter runs TapeOut NetlistVM on testnet.','Official TapeOut / DeWEB and mainnet acceptance remain pending.','Review: Studionet testnet. Configured attestors remain trusted.'])
 ];
}
export const narrationFor=scenes=>scenes.map(scene=>({key:scene.key,seconds:scene.seconds,text:{
 intro:'An agent with ambition. A card with boundaries. These are actual historical testnet requests captured from the public product, including unpaid attempts. Testnet tokens have no monetary value. Anyone can inspect these records without connecting a wallet.',
 mandate:'The owner defines the purpose and exact financial limits. The lifetime, per payment and period budgets shown here come from this deployed testnet card. TapeOut enforces numerical permission. GenLayer reviews the evidence. Owner setup and wallet controls are outside this recording.',
 direct:'Paid means delivered. This historical request transferred zero point one native issuer USDC on X Layer testnet. The actual receipt was refetched independently. An HTTP two hundred and two response or an approval is not delivery. The elapsed time shown belongs to the completed historical request.',
 bridge:'This request delivered zero point one native USDC to Base Sepolia. Source burn, destination mint and source acknowledgement were independently checked against issuer token logs and exact recipient and amount. The completed historical bridge took around twenty minutes. This film inspects its evidence rather than showing an instant live transfer.',
 block:'The amount exceeds the card limit. The budget guard blocked it before a reservation. Review was skipped. A blocked request is an attempt, not funds moved. No payment completed.',
 reject:'The purchase sought personal data for advertising, which the owner prohibited. The finalized GenLayer contract decision rejected it. Evidence approval and payment are separate. No payment completed for this request.',
 evidence:'This invoice identified the wrong buyer. The operation needs matching evidence. Review was skipped, and no payment completed. Missing evidence does not become an approval.',
 replay:'The archived testnet replay check references this exact same request. The film submits no new replay. A stable idempotency key preserves one purchase across retries.',
 commercial:'Research teams are the target. Forty nine dollars per team per month is unvalidated. Customer interviews, recurring pilots and willingness to pay remain required.',
 provenance:'The existing testnet adapter runs TapeOut NetlistVM. Official TapeOut, DeWEB and mainnet acceptance remain pending. Review uses Studionet testnet, with configured attestor trust. The original ten of twelve semantic audit remains unresolved. The later eight of eight testnet audit does not replace it.'
 }[scene.key]}));

async function capture(origin){
 assert.equal(new URL(origin).protocol,'https:');origin=new URL(origin).origin;
 await mkdir(output,{recursive:true});const sourceCommit=run('git',['rev-parse','HEAD']).trim();
 assert.equal(run('git',['status','--porcelain','--',...sourceFiles]).trim(),'','Freeze and commit film source before capture');
 const audit=await json(join(root,'docs/audits/cctp-independent.json')),config=await fetchJson(origin+'/api/v1/config');assert.equal(config.sourceCommit,sourceCommit,'Hosted API must expose the current tested source commit');
 const records=[];const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850},reducedMotion:'reduce'});
  for(const name of required){const expected=audit.cases.find(row=>row.name===name),apiUrl=origin+'/api/v1/explorer/transactions/'+expected.requestId,pageUrl=origin+'/transaction?id='+expected.requestId,body=await fetchJson(apiUrl);
   await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('.transaction-summary').waitFor({timeout:90000});assert.equal((await page.locator('.transaction-summary > .status').innerText()).trim().toLowerCase(),expected.status.toLowerCase().replaceAll('_',' '));
   await page.locator(name==='base'?'.decision-stage:last-child':'.transaction-summary').scrollIntoViewIfNeeded();await page.screenshot({path:join(output,name+'.png')});
   const screenshot=await readFile(join(output,name+'.png')),receiptLinks=await page.locator('.reasoning a').evaluateAll(links=>links.map(link=>link.href));records.push({name,apiUrl,pageUrl,body,receiptLinks,image:'data:image/png;base64,'+screenshot.toString('base64'),screenshotSha256:sha(screenshot)});
  }
 }finally{await browser.close();}
 const sources=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(join(root,file)))])));
 const captured={version:1,kind:'ACTUAL_HOSTED_TESTNET_CAPTURE',capturedAt:new Date().toISOString(),origin,sourceCommit,config,records,sources,auditSha256:sha(await readFile(join(root,'docs/audits/cctp-independent.json'))),receipts:await verifyPublicReceipts(audit)};validateCaptured(audit,captured);captured.mandateProof=await verifyCardTerms(captured,audit);await save(join(output,'capture.json'),captured);
 console.log('SUBMISSION_CAPTURE_VERIFIED');
}
async function render(){
 const capture=await json(join(output,'capture.json')),audit=await json(join(root,'docs/audits/cctp-independent.json'));validateCaptured(audit,capture);
 assert.equal(run('git',['status','--porcelain','--',...sourceFiles]).trim(),'','Freeze and commit film source before rendering');
 assert.equal(capture.auditSha256,sha(await readFile(join(root,'docs/audits/cctp-independent.json'))),'Audit changed after capture');
 for(const file of sourceFiles){const current=await readFile(join(root,file));assert.equal(capture.sources[file],sha(current),`Source changed after capture: ${file}`);const committed=spawnSync('git',['show',`${capture.sourceCommit}:${file}`],{cwd:root,maxBuffer:10*1024*1024});assert.equal(committed.status,0);assert.equal(sha(committed.stdout),sha(current),'Render inputs must match captured committed source');}
 const scenes=scenesFor(capture,audit),narration= narrationFor(scenes),concat=[];
 for(const row of narration){const textFile=join(output,row.key+'.txt'),wav=join(output,row.key+'.wav');await writeFile(textFile,row.text);
  const raw=join(output,row.key+'-raw.wav');run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`flite=textfile=${textFile}:voice=slt`,'-ar','48000',raw]);
  const duration=Number(JSON.parse(run('ffprobe',['-v','error','-show_format','-of','json',raw])).format.duration);assert.ok(duration<=row.seconds-0.8,`Narration ${row.key} (${duration}s) exceeds its scene. Shorten it before source freeze.`);
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',raw,'-af',`adelay=300|300,apad,atrim=0:${row.seconds}`,'-ar','48000','-ac','1',wav]);concat.push(`file '${wav}'`);
 }
 await writeFile(join(output,'audio-list.txt'),concat.join('\n')+'\n');run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(output,'audio-list.txt'),'-c','copy',join(output,'narration.wav')]);
 await save(join(output,'transcript.json'),narration);const props={capturedAt:capture.capturedAt,sourceCommit:capture.sourceCommit,hostedCommit:capture.config.sourceCommit,origin:capture.origin,scenes,narration:'data:audio/wav;base64,'+(await readFile(join(output,'narration.wav'))).toString('base64')};await save(join(output,'props.json'),props);
 const film=join(output,'intentguard-submission.mp4'),rendered=spawnSync(join(root,'apps/motion/node_modules/.bin/remotion'),['render','src/index.ts','SubmissionDemo',film,'--props='+join(output,'props.json'),'--codec=h264','--crf=20','--pixel-format=yuv420p','--audio-codec=aac','--audio-bitrate=128k','--concurrency=2'],{cwd:join(root,'apps/motion'),stdio:'inherit'});assert.equal(rendered.status,0,'Remotion export must finish successfully');
 await save(join(output,'artifact.json'),{version:1,kind:'EXPORTED_VERIFIED_RECORD_SUBMISSION',file:relative(root,film),sha256:sha(await readFile(film)),captureSha256:sha(await readFile(join(output,'capture.json'))),propsSha256:sha(await readFile(join(output,'props.json'))),transcriptSha256:sha(await readFile(join(output,'transcript.json'))),sourceCommit:capture.sourceCommit,renderedAt:new Date().toISOString(),narration:'Locally synthesized ffmpeg flite slt voice; captions and transcript provided',durationSeconds:scenes.reduce((sum,row)=>sum+row.seconds,0)});
 console.log('SUBMISSION_RENDER_EXPORTED');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const command=process.argv[2];if(command==='capture')await capture(process.argv[3]??'https://intentguard-tapeout.vercel.app');else if(command==='render')await render();else throw Error('Usage: node apps/motion/scripts/submission-demo.mjs capture [https://host] | render');
}
