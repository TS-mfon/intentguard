import assert from "node:assert/strict";
import {readFile,mkdir,open} from "node:fs/promises";
import {resolve,join} from "node:path";
import {parseStrictJson} from "../packages/shared/strict-json.ts";
import {availabilityContract,validateCampaign,runnerProvenance,probeTarget,sampleSuccess,evidenceHash} from "../tools/production/availability.mjs";
import {observeBrowser,observeGatewayFiles} from "./availability-browser.mjs";

const [campaignPath,environment,outputPath]=process.argv.slice(2);
assert.ok(campaignPath&&outputPath&&["testnet","mainnet"].includes(environment),"Usage: availability-probe.mjs <campaign.json> <testnet|mainnet> <output-directory>");
const campaign=validateCampaign(parseStrictJson(campaignPath==="-"?process.env.INTENTGUARD_AVAILABILITY_CAMPAIGN??"":await readFile(resolve(campaignPath),"utf8"))),provenance=runnerProvenance();assert.equal(provenance.monitorSourceCommit,campaign.monitorSourceCommit,"Monitor source changed during the campaign");assert.equal(process.env.INTENTGUARD_AVAILABILITY_CAMPAIGN_ID,campaign.campaignId,"Artifact campaign identity changed");const target=campaign.targets.find(t=>t.paymentEnvironment===environment),start=Date.parse(campaign.startAt),end=Date.parse(campaign.endAt),batchEnd=Math.min(Date.now()+65*60000,end);
assert.ok(Date.now()<end,"Campaign already finished");const directory=resolve(outputPath);await mkdir(directory,{recursive:true});const records=await open(join(directory,"records.jsonl"),"wx",0o600);
let count=0,successful=0;
try{for(let slot=Math.max(start,Math.ceil(Date.now()/availabilityContract.intervalMs)*availabilityContract.intervalMs);slot<batchEnd;slot+=availabilityContract.intervalMs){if(slot>Date.now())await new Promise(done=>setTimeout(done,slot-Date.now()));const observedAt=Date.now(),browserRequired=(slot-start)%availabilityContract.browserIntervalMs===0,checks=await probeTarget(target,{browser:browserRequired,browserProbe:observeBrowser,gatewayProbe:observeGatewayFiles}),body={version:1,campaignId:campaign.campaignId,paymentEnvironment:environment,provenance,slotAt:slot,observedAt,finishedAt:Date.now(),browserRequired,checks};let success=false;try{success=sampleSuccess(body,target)&&body.finishedAt<slot+availabilityContract.intervalMs;}catch{}const row={...body,success},sample={...row,recordSha256:evidenceHash(row)};await records.write(JSON.stringify(sample)+"\n");await records.sync();count++;if(success)successful++;console.log(JSON.stringify({campaignId:campaign.campaignId,environment,os:provenance.os,slotAt:new Date(slot).toISOString(),success}));}}
finally{await records.close();}
assert.ok(count>0,"No scheduled samples fit this batch");console.log(JSON.stringify({observedSlots:count,successfulSlots:successful,scope:"One live batch; 72-hour availability remains unverified"}));
