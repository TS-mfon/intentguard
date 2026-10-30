/** Publish only verified testnet interpreter, source identity and private sandbox settings. */
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {loadEnvFile} from "node:process";
import {readFile,writeFile,chmod} from "node:fs/promises";
import {createHash} from "node:crypto";

for(const path of [".local/testnet-secrets.env",".local/hosting.env"])loadEnvFile(path);
assert.equal(process.env.INTENTGUARD_MODE,"testnet");assert.equal(process.env.XLAYER_CHAIN_ID,"1952");
const action=process.argv[2];assert.ok(["interpreter","source","sandbox"].includes(action));
const repo="TS-mfon/intentguard";
async function setting(platform:"github"|"vercel",name:string,value:string){
 const args=platform==="github"?["variable","set",name,"--repo",repo]:["env","add",name,"production","--force"];
 await new Promise<void>((resolve,reject)=>{const child=spawn(platform==="github"?"gh":"vercel",args,{stdio:["pipe","ignore","pipe"]});child.stderr.resume();child.once("error",()=>reject(Error("Setting process could not start")));child.once("exit",code=>code===0?resolve():reject(Error(platform+" setting failed: "+name)));child.stdin.end(value);});
 console.log(platform+" configured "+name);
}
if(action==="interpreter"){
 const deployment=JSON.parse(await readFile("docs/production/interpreter-v2-deployment.json","utf8"));
 assert.equal(deployment.reviewChainId,61999);assert.equal(deployment.paymentChainId,1952);assert.equal(deployment.interpreterVersion,2);
 assert.equal(createHash("sha256").update(await readFile(deployment.sourceFile)).digest("hex"),deployment.sourceSha256);
 const value=deployment.interpreterAddress;assert.match(value,/^0x[0-9a-fA-F]{40}$/);assert.ok(deployment.verifiedAt&&deployment.legacyDraftsPinned);
 const path=".local/testnet-secrets.env",saved=await readFile(path,"utf8");assert.ok(/^GENLAYER_INTERPRETER_ADDRESS=.*$/m.test(saved));
 await writeFile(path,saved.replace(/^GENLAYER_INTERPRETER_ADDRESS=.*$/m,"GENLAYER_INTERPRETER_ADDRESS="+value),{mode:0o600});await chmod(path,0o600);
 await setting("github","GENLAYER_INTERPRETER_ADDRESS",value);await setting("vercel","GENLAYER_INTERPRETER_ADDRESS",value);
}else if(action==="source"){
 const current=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();assert.equal(process.argv[3],current,"Source identity must name current HEAD");assert.match(current,/^[a-f0-9]{40}$/);
 assert.equal(execFileSync("git",["status","--porcelain","--","apps/web","packages/shared","packages/sdk","pnpm-lock.yaml"],{encoding:"utf8"}).trim(),"","Publish committed application source");
 await setting("vercel","INTENTGUARD_SOURCE_COMMIT",current);
}else{
 loadEnvFile(".local/sandbox-agent.env");
 const names=["INTENTGUARD_SANDBOX_CARD_ID","INTENTGUARD_SANDBOX_OWNER","INTENTGUARD_SANDBOX_API_KEY","INTENTGUARD_SANDBOX_MAX_REQUESTS"];
 assert.match(process.env.INTENTGUARD_SANDBOX_CARD_ID??"",/^0x[0-9a-fA-F]{64}$/);assert.match(process.env.INTENTGUARD_SANDBOX_OWNER??"",/^0x[0-9a-fA-F]{40}$/);assert.match(process.env.INTENTGUARD_SANDBOX_API_KEY??"",/^ig_/);assert.equal(process.env.INTENTGUARD_SANDBOX_MAX_REQUESTS,"30");
 for(const name of names)await setting("vercel",name,process.env[name]!);
}
console.log("VERIFIED_TESTNET_SETTINGS_CONFIGURED "+action);
