import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const env={PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:"1",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
function run(command,args,marker){
 const result=spawnSync(command,args,{cwd:root,env,encoding:"utf8",timeout:300000,maxBuffer:16*1024*1024});
 const output=(result.stdout??"")+(result.stderr??"");
 if(result.error||result.status!==0){process.stderr.write(output);throw Error("Loading layout verification failed: "+args.join(" "));}
 if(marker)assert.ok(output.includes(marker),"Missing successful production browser marker");
}
run("pnpm",["build"]);
for(const blocked of [false,true]){
 run(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/identity-browser.ts",...(blocked?["--without-fonts"]:[])],"Identity browser verification passed");
 const folder=blocked?"identity-screenshots-font-fallback":"identity-screenshots";
 const report=JSON.parse(readFileSync(new URL("../../.local/"+folder+"/browser-report.json",import.meta.url),"utf8"));
 assert.equal(report.fontDownloadsBlocked,blocked);assert.deepEqual(report.pageErrors,[]);
 assert.deepEqual(report.cardUsageLoadingViewports,[320,390,768,1440]);
 assert.ok(report.checks.includes("controlled pending card usage fits required viewports and renders measured data after release"));
 console.log("Production pending/loaded card layout verified; webfonts "+(blocked?"blocked":"available"));
}
console.log("LOADING_LAYOUT_VERIFIED");
