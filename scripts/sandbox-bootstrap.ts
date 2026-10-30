/** Reviewed testnet-only sandbox binding. No deployment, signing or token transfer. */
import assert from "node:assert/strict";
import {mkdir,open,access,lstat,realpath} from "node:fs/promises";
import {resolve,relative,dirname} from "node:path";
import {address,digest,hash} from "../packages/shared";
import {configuration} from "../apps/web/lib/config";
import {database} from "../apps/web/lib/store";
import type {Card} from "../apps/web/lib/models";
import {Evm} from "../apps/web/lib/evm";
import {GenLayer} from "../apps/web/lib/genlayer";
import {issueKey} from "../apps/web/lib/auth";
import {assertSandboxCard,sandboxPolicy} from "../apps/web/lib/sandbox";

const root=resolve(import.meta.dirname,".."),args=process.argv.slice(2),command=args.shift(),flags=new Map<string,string>();
for(let i=0;i<args.length;i++){const key=args[i];assert.ok(key.startsWith("--"),"Use explicit named options");assert.ok(!flags.has(key),"Duplicate option");if(key==="--acknowledge-dedicated-testnet-card")flags.set(key,"true");else{assert.ok(args[i+1]&&!args[i+1].startsWith("--"),"Missing option value");flags.set(key,args[++i]);}}
const permitted=new Set(command==="plan"?["--output"]:["--output","--card-id","--owner","--acknowledge-dedicated-testnet-card"]);
for(const key of flags.keys())assert.ok(permitted.has(key),"Unknown option");
const cfg=configuration();assert.equal(cfg.mode,"testnet","Sandbox bootstrap requires explicit testnet mode");assert.equal(cfg.chainId,1952);assert.notEqual(cfg.databaseName,"intentguard_mainnet");
const requested=flags.get("--output");assert.ok(requested,"Supply --output under .local/");const output=resolve(root,requested),rel=relative(root,output);assert.ok(rel.startsWith(".local/")&&!rel.includes(".."),"Output must stay in the ignored .local directory");
assert.ok(output.endsWith(command==="plan"?".json":".env"),"Plan outputs use .json; private binding outputs use .env");
// Validate every parent before creating a private file; symlinked directories
// must not redirect the key into another directory or shared artifact.
let parent=root;for(const segment of relative(root,dirname(output)).split("/")){parent=resolve(parent,segment);let info;try{info=await lstat(parent);}catch(e){if((e as {code?:string}).code!=="ENOENT")throw e;await mkdir(parent,{mode:0o700});info=await lstat(parent);}assert.ok(info.isDirectory()&&!info.isSymbolicLink(),"Private output parents must be real directories");}
assert.equal(await realpath(dirname(output)),dirname(output),"Private output must use its canonical directory");
if(command==="plan"){
 const policy=sandboxPolicy(address.parse(process.env.DEMO_MERCHANT_RECIPIENT),cfg.origin),plan={kind:"DEDICATED_TESTNET_SANDBOX_PLAN",paymentEnvironment:"testnet",paymentChainId:1952,description:policy.mission,guidance:policy,settlement:{asset:"USDC",destinationChainIds:[1952]},limits:{normalAmount:"0.000001",blockedAmount:"0.010001",maxAdmissions:30,requestsPerVisitor:5},requiredNextSteps:["The owner submits this exact policy through the configured owner draft API and reviews finalized terms.","Activate this dedicated vault through the existing verified native-USDC testnet factory.","Register the actual activation receipt and wait for the versioned GenLayer reviewer to become READY.","Fund only this owned testnet vault with native testnet USDC; 0.001USDC covers the default gateway's maximum admitted transfers.","Run bind only after reviewing the exact card ID and actual receipts. Never use a customer or historical audit card.","Store the generated private server variables through the configured hosting secrets mechanism; never use NEXT_PUBLIC_ variables."]};
 const handle=await open(output,"wx",0o600);try{await handle.writeFile(JSON.stringify(plan,null,2)+"\n");}finally{await handle.close();}console.log(JSON.stringify({kind:plan.kind,path:rel,policyHash:digest(policy),signatures:0,broadcasts:0}));
}else{
 assert.equal(command,"bind","Use only plan or bind; there is no deploy, sign or send command");assert.equal(flags.get("--acknowledge-dedicated-testnet-card"),"true","Confirm the selected card is the new dedicated testnet sandbox");
 const cardId=hash.parse(flags.get("--card-id")),owner=address.parse(flags.get("--owner")).toLowerCase();
 assert.equal(process.env.INTENTGUARD_SANDBOX_OWNER?.toLowerCase(),owner,"Set the explicit dedicated sandbox owner before binding");
 try{await access(output);throw Error("The private output already exists; choose a new file before rotating any key");}catch(e){if((e as {code?:string}).code!=="ENOENT")throw e;}
 const store=await database(),card=await store.get<Card>("cards",cardId);assert.ok(card,"Actual dedicated card not found");assertSandboxCard(card,owner,false);assert.equal(card.state,"READY","Wait for the actual reviewer to become ready");assert.equal(card.policyHash,digest(card.policy),"Policy commitment mismatch");
 const evm=new Evm(store),gl=new GenLayer(store);await evm.verifyActivation(owner,card.policy,card.address,card.activationTx,card.settlement);assert.equal((await gl.reviewer(card)).toLowerCase(),card.reviewerAddress?.toLowerCase(),"Actual reviewer identity mismatch");assert.equal((await evm.view(card)).status,"ACTIVE","The dedicated testnet card must be active");
 const handle=await open(output,"wx",0o600);try{const apiKey=await issueKey(store,card._id,owner);await handle.writeFile(["INTENTGUARD_SANDBOX_CARD_ID="+card._id,"INTENTGUARD_SANDBOX_OWNER="+owner,"INTENTGUARD_SANDBOX_API_KEY="+apiKey,"INTENTGUARD_SANDBOX_MAX_REQUESTS=30",""].join("\n"));await store.patch("cards",card._id,{sandbox:true,sandboxBoundAt:Date.now()});}finally{await handle.close();}
 console.log(JSON.stringify({kind:"DEDICATED_TESTNET_SANDBOX_BOUND",cardId:card._id,cardAddress:card.address,owner,privateOutput:rel,policyHash:card.policyHash,reviewerAddress:card.reviewerAddress,activationTx:card.activationTx,paymentEnvironment:"testnet",paymentChainId:1952,apiKeyPrinted:false,signatures:0,broadcasts:0}));
}
