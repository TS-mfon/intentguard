import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {ROOT,ReadOnlyRpc,regularBytes,verifySources,gitCommit,quantity,observeProtocol} from "./protocol.mjs";
import {scanBundle} from "./bundle.mjs";
import {makeQuote,publicationPlan,provisioningPlan,resumePublication} from "./planner.mjs";
const ALLOWED=new Set(["directory","processor","tokenId","cpuIndex","owner","capWei","months","apiOrigins","quotePath","planPath","expectedHash"]);
async function json(path){const bytes=await regularBytes(resolve(path));assert.ok(bytes.length<=256*1024*1024,"Input is too large");return JSON.parse(bytes.toString("utf8"));}
export async function main(args=process.argv.slice(2)){
 assert.equal(Number(process.versions.node.split(".")[0]),24,"Use the reviewed Node24 toolchain");
 const [command,input]=args;assert.ok(["sources","probe","quote","plan","resume"].includes(command),"Use sources, probe, quote, plan or resume; no execution command exists");
 if(command==="probe"){assert.equal(args.length,1);await verifySources();console.log(JSON.stringify(await observeProtocol(new ReadOnlyRpc()),null,2));return;}
 if(command==="sources"){assert.equal(args.length,1);console.log(JSON.stringify(await verifySources(),null,2));return;}
 assert.equal(args.length,2,"Provide one JSON configuration file");
 const config=await json(input);assert.ok(config&&typeof config==="object"&&!Array.isArray(config));
 for(const key of Object.keys(config))assert.ok(ALLOWED.has(key),"Unsupported config key: "+key);
 const sources=await verifySources();
 if(command==="quote"){
  const rpc=new ReadOnlyRpc();const protocol=await observeProtocol(rpc,config);
  const bundle=config.directory?await scanBundle(config.directory,{apiOrigins:config.apiOrigins??[]}):null;
  const gasPriceWei=quantity(await rpc.request("eth_gasPrice",[])).toString();
  const quote=makeQuote({protocol,sources,bundle,sourceCommit:gitCommit(),owner:config.owner,capWei:config.capWei,gasPriceWei,months:config.months??1});
  console.log(JSON.stringify(quote,null,2));return;
 }
 assert.ok(config.quotePath&&config.expectedHash&&config.capWei,"Quote path, exact hash and cap are required");
 const quote=await json(config.quotePath);const options={expectedHash:config.expectedHash,capWei:config.capWei};
 if(command==="plan"){
  const plan=quote.bundle?publicationPlan(quote,options):provisioningPlan(quote,options);
  console.log(JSON.stringify(plan,null,2));return;
 }
 assert.ok(config.planPath&&config.directory,"Resume requires plan path and static directory");
 const plan=await json(config.planPath);
 console.log(JSON.stringify(await resumePublication(plan,quote,{...options,directory:config.directory,rpc:new ReadOnlyRpc(),sourceRoot:ROOT}),null,2));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{await main();}catch(e){console.error("Hosting planner refused: "+String(e.message).slice(0,500));process.exitCode=1;}
}
