import {spawnSync} from "node:child_process";

const required=[
 "complete guided onboarding rejects malformed money as field errors without queuing review",
 "valid complete onboarding preserves exact owner policy input and still queues substantive consensus",
 "partial and legacy guidance retain their interpreter path and historical input commitments",
 "draft diagnostics are allowlisted and only finalized proposed policies expose activation",
 "owner gallery supplies actual PAID-only usage without querying every public preview",
 "SDK aliases use their own challenge URI and origin-bound memory-only owner session",
 "SDK fails closed on ambiguous frontend allowlists or deployment links before sending credentials",
 "protocol test merchant config is testnet-only actual public information and never exposes its admin key",
 "cross-environment, API, frontend, reviewer and release mismatches send no credential"
];
const result=spawnSync("pnpm",["exec","tsx","--test","tests/onboarding-api.test.ts","tests/frontend-origins.test.ts","tests/sdk-profile.test.ts","tests/cross-origin-auth.test.ts","tests/studionet-setup.test.ts","tests/worker.test.ts"],{encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024});
const output=(result.stdout??"")+(result.stderr??"");
if(result.error||result.status!==0){process.stderr.write(output);throw Error("Onboarding API regression failed");}
const count=name=>Number(output.match(new RegExp("(?:ℹ |# )"+name+" (\\d+)"))?.[1]??-1);
if(count("tests")<50||count("tests")!==count("pass")||["fail","skipped","cancelled","todo"].some(name=>count(name)!==0))throw Error("Onboarding verification refuses absent, skipped or failing tests");
for(const name of required)if(!output.includes("✔ "+name+" (")&&!output.includes(" - "+name+"\n"))throw Error("Missing passing control: "+name);
console.log(JSON.stringify({scope:"local onboarding API and client integration",passed:count("pass"),liveActivation:"unverified"}));
console.log("ONBOARDING_API_VERIFIED");
