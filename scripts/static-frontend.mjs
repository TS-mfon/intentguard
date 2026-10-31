import {cp,mkdir,rm,readFile,writeFile,symlink,open,lstat,readdir} from "node:fs/promises";
import {resolve,join,relative} from "node:path";
import {spawn,execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {scanBundle} from "../tools/hosting/bundle.mjs";
const root=resolve(import.meta.dirname,".."),stage=join(root,".local","static-frontend-stage"),output=join(root,".local","static-frontend");
// Stage only client-safe library inputs; API and database modules stay with the server.
const clientLibraryPaths=["apps/web/lib/agent-card-art.ts"];
function canonicalOrigin(raw){const value=new URL(raw);if(value.protocol!=="https:"||value.origin!==raw)throw Error("Use a canonical HTTPS origin.");return value.origin;}
export async function buildStatic({paymentEnvironment,apiOrigin,frontendOrigin,sourceCommit,final=false}){
 if(!["mainnet","testnet"].includes(paymentEnvironment))throw Error("Choose explicit mainnet or testnet payments.");
 apiOrigin=canonicalOrigin(apiOrigin);if(frontendOrigin)frontendOrigin=canonicalOrigin(frontendOrigin);
 sourceCommit??=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
 if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error("Exact source commit required.");
 if(sourceCommit!==execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim())throw Error("The supplied source commit is not the checked-out source.");
 const builderInputs=["scripts/static-frontend.mjs","tools/hosting/bundle.mjs","tools/hosting/protocol.mjs","tools/hosting/pins.json"];
 const sourcePaths=["apps/web/app","apps/web/components","apps/web/public","apps/web/next.config.ts","apps/web/tsconfig.json","apps/web/package.json","packages/shared","contracts/evm/abi.json","tsconfig.json","package.json","pnpm-lock.yaml","pnpm-workspace.yaml",...clientLibraryPaths,...builderInputs];
 const dirty=()=>execFileSync("git",["status","--porcelain","--untracked-files=all","--",...sourcePaths],{cwd:root,encoding:"utf8"}).trim().length>0;
 if(final&&dirty())throw Error("Final static export requires clean source at the checked-out commit.");
 await mkdir(join(root,".local"),{recursive:true});
 const local=await lstat(join(root,".local"));if(!local.isDirectory()||local.isSymbolicLink())throw Error("Refusing a generated directory symlink.");
 const lock=await open(join(root,".local","static-frontend.lock"),"wx");
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,sourceCommit,startedAt:new Date().toISOString()}));
  for(const path of [stage,output]){const existing=await lstat(path).catch(()=>null);if(existing?.isSymbolicLink())throw Error("Refusing a generated path symlink.");await rm(path,{recursive:true,force:true});}
  await mkdir(join(stage,"apps","web"),{recursive:true});await mkdir(join(stage,"contracts","evm"),{recursive:true});
  for(const name of ["app","components","public"]){
   const src=join(root,"apps","web",name);
   await cp(src,join(stage,"apps","web",name),{recursive:true,filter:path=>{
    const rel=relative(join(root,"apps","web","app"),path).replaceAll("\\","/");
    return name!=="app"||(!/^api(?:\/|$)/.test(rel)&&!/^explorer\/transactions(?:\/|$)/.test(rel));
   }});
  }
  await mkdir(join(stage,"apps","web","lib"),{recursive:true});
  for(const path of clientLibraryPaths)await cp(join(root,path),join(stage,path));
  for(const name of ["next.config.ts","tsconfig.json","package.json"])await cp(join(root,"apps","web",name),join(stage,"apps","web",name));
  for(const name of ["tsconfig.json","package.json","pnpm-lock.yaml","pnpm-workspace.yaml"])await cp(join(root,name),join(stage,name));
  await cp(join(root,"packages","shared"),join(stage,"packages","shared"),{recursive:true});
  await cp(join(root,"contracts","evm","abi.json"),join(stage,"contracts","evm","abi.json"));
  await symlink(join(root,"node_modules"),join(stage,"node_modules"),"dir");
  await symlink(join(root,"apps","web","node_modules"),join(stage,"apps","web","node_modules"),"dir");
  const env={PATH:process.env.PATH,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",INTENTGUARD_STATIC_EXPORT:"1",NEXT_PUBLIC_INTENTGUARD_STATIC_EXPORT:"1",NEXT_PUBLIC_INTENTGUARD_PAYMENT_ENV:paymentEnvironment,NEXT_PUBLIC_INTENTGUARD_API_ORIGIN:apiOrigin,NEXT_PUBLIC_INTENTGUARD_SOURCE_COMMIT:sourceCommit,...(frontendOrigin?{NEXT_PUBLIC_INTENTGUARD_FRONTEND_ORIGIN:frontendOrigin}:{})};
  if(process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
  const command=join(root,"apps","web","node_modules","next","dist","bin","next");
  await new Promise((ok,fail)=>{const process=spawn(globalThis.process.execPath,[command,"build","--webpack"],{cwd:join(stage,"apps","web"),env,stdio:"inherit"});process.once("error",fail);process.once("exit",code=>code===0?ok():fail(Error("Static Next build failed: "+code)));});
  await cp(join(stage,"apps","web","out"),join(output,"out"),{recursive:true});
  const bundle=await scanBundle(join(output,"out"),{apiOrigins:[apiOrigin]}),sourceFiles={};
  async function hashSources(directory){for(const file of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(directory,file.name);if(file.isDirectory())await hashSources(path);else if(file.isFile())sourceFiles[relative(stage,path).replaceAll("\\","/")]=createHash("sha256").update(await readFile(path)).digest("hex");}}
  for(const name of ["app","components","public"])await hashSources(join(stage,"apps","web",name));
  await hashSources(join(stage,"packages","shared"));
  for(const path of ["apps/web/next.config.ts","apps/web/tsconfig.json","apps/web/package.json","contracts/evm/abi.json","tsconfig.json","package.json","pnpm-lock.yaml","pnpm-workspace.yaml",...clientLibraryPaths]){sourceFiles[path]=createHash("sha256").update(await readFile(join(stage,path))).digest("hex");}
  for(const path of builderInputs)sourceFiles[path]=createHash("sha256").update(await readFile(join(root,path))).digest("hex");
  const sourceInputs=Object.fromEntries(Object.entries(sourceFiles).sort(([a],[b])=>a.localeCompare(b)));
  for(const[path,expected]of Object.entries(sourceInputs))if(createHash("sha256").update(await readFile(join(root,path))).digest("hex")!==expected)throw Error("A frontend source input changed during the build: "+path);
  const sourceDirty=dirty();if(final&&sourceDirty)throw Error("Final static export source changed during the build.");
  const actualCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  if(sourceCommit!==actualCommit)throw Error("The supplied source commit is not the checked-out source.");
  const toolchain={node:process.version,pnpm:execFileSync("pnpm",["--version"],{cwd:root,encoding:"utf8"}).trim(),next:JSON.parse(await readFile(join(root,"apps/web/node_modules/next/package.json"),"utf8")).version};
  const manifest={version:1,status:"PREPARED_NOT_HOSTED",sourceCommit,sourceDirty,sourceInputs,toolchain,sourceTreeSha256:createHash("sha256").update(JSON.stringify(sourceInputs)).digest("hex"),paymentEnvironment,paymentChainId:paymentEnvironment==="mainnet"?196:1952,reviewEnvironment:"testnet",reviewNetwork:"studionet",reviewChainId:61999,apiOrigin,frontendOrigin:frontendOrigin??null,generatedAt:new Date().toISOString(),bundle,serverRoutesIncluded:false,canonicalTransactionRoute:"/transaction?id=<requestId>",legacyTransactionFallback:"/explorer/transactions/<requestId>"};
  await writeFile(join(output,"manifest.json"),JSON.stringify(manifest,null,2));return {directory:join(output,"out"),manifest};
 }finally{await lock.close();await rm(join(root,".local","static-frontend.lock"),{force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const flags=new Map();for(let i=2;i<process.argv.length;i++){const flag=process.argv[i];if(flags.has(flag)||!["--payment-environment","--api-origin","--frontend-origin","--source-commit","--final"].includes(flag))throw Error("Unsupported or duplicate static export option: "+flag);if(flag==="--final")flags.set(flag,true);else{const value=process.argv[++i];if(!value||value.startsWith("--"))throw Error("Missing static export option value: "+flag);flags.set(flag,value);}}
 const result=await buildStatic({paymentEnvironment:flags.get("--payment-environment"),apiOrigin:flags.get("--api-origin"),frontendOrigin:flags.get("--frontend-origin"),sourceCommit:flags.get("--source-commit"),final:flags.has("--final")});
 console.log(JSON.stringify({status:result.manifest.status,output:result.directory,files:result.manifest.bundle.files.length,totalBytes:result.manifest.bundle.totalBytes,bundleSha256:result.manifest.bundle.directorySha256}));
}
