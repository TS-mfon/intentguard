import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {scanBundle,checkContent,validatePath} from "../hosting/bundle.mjs";
import {buildStatic} from "../../scripts/static-frontend.mjs";
const root=resolve(import.meta.dirname,"../.."),folder=join(root,".local/production-frontend");
const environment={PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:"1",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
async function run(command,args,expected){
 let output="";await new Promise((done,fail)=>{const child=spawn(command,args,{cwd:root,env:environment,stdio:["ignore","pipe","pipe"]});child.stdout.on("data",chunk=>{output+=chunk.toString();process.stdout.write(chunk);});child.stderr.on("data",chunk=>{output+=chunk.toString();process.stderr.write(chunk);});child.once("error",fail);child.once("exit",code=>code===0?done():fail(Error(command+" failed: "+code)));});
 if(expected)assert.ok(output.includes(expected),"Missing successful check marker: "+expected);
 return createHash("sha256").update(output).digest("hex");
}
await mkdir(folder,{recursive:true});
assert.throws(()=>checkContent(Buffer.from('const key="-----BEGIN PRIVATE KEY-----";'),"fixture.js"),/Credential detected/);
assert.throws(()=>validatePath("secrets.env"),/Forbidden/);
await assert.rejects(buildStatic({paymentEnvironment:"mainnet",apiOrigin:"https://api.example",frontendOrigin:"https://frontend.example",sourceCommit:"0".repeat(40)}),/not the checked-out source/);
const checks={};
for(const paymentEnvironment of ["mainnet","testnet"]){
 checks[paymentEnvironment]=await run("pnpm",["exec","tsx","scripts/production-browser.ts","--environment="+paymentEnvironment],"FRONTEND_BROWSER_VERIFIED "+paymentEnvironment);
 const manifest=JSON.parse(await readFile(join(root,".local/static-frontend/manifest.json"),"utf8"));
 const bundle=await scanBundle(join(root,".local/static-frontend/out"),{apiOrigins:[manifest.apiOrigin]});assert.equal(bundle.directorySha256,manifest.bundle.directorySha256);
 assert.equal(manifest.serverRoutesIncluded,false);assert.equal(manifest.paymentEnvironment,paymentEnvironment);assert.equal(manifest.reviewChainId,61999);
 for(const path of ["apps/web/next.config.ts","packages/shared/index.ts","contracts/evm/abi.json","pnpm-lock.yaml","scripts/static-frontend.mjs","tools/hosting/bundle.mjs","tools/hosting/protocol.mjs","tools/hosting/pins.json"])assert.ok(manifest.sourceInputs[path],"Missing source provenance: "+path);
 assert.equal(createHash("sha256").update(JSON.stringify(manifest.sourceInputs)).digest("hex"),manifest.sourceTreeSha256);
 await writeFile(join(folder,paymentEnvironment+"-static-manifest.json"),JSON.stringify(manifest,null,2));
}
checks.standalone=await run("pnpm",["--filter","@intentguard/web","build"]);
assert.ok((await readFile(join(root,"apps/web/.next/standalone/apps/web/server.js"),"utf8")).length>0,"Standalone server missing");
await writeFile(join(folder,"verification.json"),JSON.stringify({version:1,status:"FRONTEND_PREPARED",checks,liveHostedAcceptance:false,verifiedAt:new Date().toISOString()},null,2));
console.log("FRONTEND_PREPARED");
