import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {parseEnv} from "node:util";
const root=new URL("../",import.meta.url);
const candidates=new Set();
for(const path of [new URL(".local/testnet-secrets.env",root),new URL(".local/hosting.env",root),new URL(".local/worker-wake.env",root),new URL(".local/audit-agent.env",root),new URL(".local/sandbox-agent.env",root),new URL("file:///home/sudodave/.env.build")]){
 let body;try{body=await readFile(path,"utf8")}catch(error){if(error.code==="ENOENT")continue;throw error}
 for(const [name,value]of Object.entries(parseEnv(body))){
  if(!/PRIVATE_KEY|PASSWORD|SESSION_SECRET|API_KEY|ADMIN_KEY|VERCEL_TOKEN|GH_TOKEN|GITHUB_TOKEN|GITHUB_WORKER_TOKEN|MONGODB_URI/i.test(name)||value.length<8)continue;
  candidates.add(value);candidates.add(encodeURIComponent(value));
  if(/PRIVATE_KEY/i.test(name)&&value.startsWith("0x"))candidates.add(value.slice(2));
 }
}
assert.ok(candidates.size>0,"Private environment must be available to compare secrets");
const paths=execFileSync("git",["diff","--cached","--name-only","-z","--diff-filter=ACMR"],{cwd:root}).toString().split("\0").filter(Boolean);
for(const path of paths){
 assert.ok(!/^(?:\.local|\.unlazy|\.vercel)\//.test(path),"Private state is staged");
 assert.ok(!/(^|\/)\.env(?:\.|$)/.test(path)||path===".env.example","Environment file is staged");
 const body=execFileSync("git",["show",":"+path],{cwd:root,maxBuffer:16*1024*1024}).toString();
 for(const secret of candidates)assert.ok(!body.includes(secret),"Sensitive credential found in staged file: "+path);
}
console.log("STAGED_SECRET_SCAN_PASSED",paths.length,"files");
