import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

// This verifier tests immutable action pins, privileged-input boundaries and
// GitHub secret fallback. It does not certify the live Environment settings.
const root=process.cwd();
const workflows=new Map(readdirSync(join(root,".github/workflows")).filter(n=>/\.ya?ml$/.test(n)).map(n=>[n,readFileSync(join(root,".github/workflows",n),"utf8")]));
const pins=new Set([
 "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
 "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
 "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
 "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
 "foundry-rs/foundry-toolchain@dba66c27052e63476d886f22216e119ba7e615bf",
 "astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e",
]);
function verifyWorkflows(files){
 for(const[name,text]of files){
  assert(!text.includes("pull_request_target"),name+" must not run untrusted PR code with secrets");
  assert(!text.includes("ubuntu-latest"),name+" must pin runner distribution");
  const uses=[...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(m=>m[1]);assert(uses.length);
  for(const action of uses)assert(pins.has(action),name+" has mutable/unapproved action "+action);
  assert.match(text,/node-version: "24\.18\.0"/);
  assert(!text.includes('node-version: "24"'));
  for(const[,body]of text.matchAll(/uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=\n\s*- |\n  [a-z]+:|$)/g))assert.match(body,/persist-credentials: false/);
  if(["validate.yml","verify-hosted.yml"].includes(name)){
   assert(!text.includes("secrets."),name+" must not receive execution principals");
   assert(!/^\s*(actions|contents): write$/m.test(text),name+" must use read-only token permissions");
  }
  if(["worker.yml","cctp-operations.yml","cctp-audit.yml","reviewer-v2-probe.yml"].includes(name)){
   assert.match(text,/if: github\.ref == 'refs\/heads\/main'/);
   assert.match(text,/INTENTGUARD_PAYMENT_ENV: testnet/);
   assert.match(text,/\$XLAYER_CHAIN_ID" != "1952"/);
   assert.match(text,/\$MONGODB_DB" == "intentguard_mainnet"/);
  }
 }
 const validation=files.get("validate.yml");assert.match(validation,/run: pnpm audit(?:\n|$)/);assert.match(validation,/version: v1\.8\.6/);
 assert.match(validation,/version: "0\.13\.5"/);assert.match(validation,/python-version: "3\.13\.12"/);
 assert.match(validation,/genvm-linter==0\.11\.0/);assert.match(validation,/genlayer-test==0\.29\.2/);
 const main=files.get("worker-mainnet.yml");assert(main);
 for(const pattern of [/environment: mainnet/,/group: intentguard-worker-mainnet/,/cancel-in-progress: false/,/ref: \$\{\{ env\.RELEASE_REF \}\}/,/INTENTGUARD_PAYMENT_ENV: mainnet/,/GENLAYER_NETWORK: studionet/,/XLAYER_CHAIN_ID: "196"/])assert.match(main,pattern);
 assert.match(files.get("worker.yml"),/group: intentguard-worker-testnet/);
 assert.match(files.get("cctp-operations.yml"),/group: intentguard-worker-testnet/);
 assert(!main.split("- name: Execute the isolated mainnet queue")[0].includes("secrets."),"Keys must enter only after release preflight");
 assert.match(main,/INTENTGUARD_DATABASE_ROLE: worker/);
 assert.match(main,/vars\.MAINNET_WORKER_SCHEDULE_ENABLED == 'true'/);
 for(const name of ["MONGODB_URI","XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY","GENLAYER_OPERATOR_PRIVATE_KEY"]){
  assert(!main.includes("secrets."+name+" "), "Mainnet must not fall back to the repository testnet principal "+name);
  assert(main.includes("secrets.MAINNET_"+name+" "), "Dedicated mainnet principal missing "+name);
 }
}
function checkGuard(){
 const raw=workflows.get("worker-mainnet.yml").split("      - name: Refuse unapproved release or mixed environment before checkout and signing\n")[1]?.split("\n      - uses:")[0];assert(raw);
 const script=raw.split("        run: |\n")[1].split("\n").map(l=>l.replace(/^ {10}/,"")).join("\n");
 assert(!/\$\{\{/.test(script),"Inputs must enter through env, never shell interpolation");
 const good={PATH:process.env.PATH,MAINNET_WORKER_ENABLED:"true",RELEASE_REF:"a".repeat(40),INTENTGUARD_SOURCE_COMMIT:"a".repeat(40),MONGODB_DB:"intentguard_mainnet",APP_URL:"https://mainnet.invalid",INTENTGUARD_RELEASE_ID:"packaging-check",INTENTGUARD_VERIFIED_MANIFEST:"docs/deployments/mainnet.json",INTENTGUARD_VERIFIED_MANIFEST_SHA256:"b".repeat(64),GENLAYER_CONSENSUS_ADDRESS:"0x"+"2".repeat(40),GENLAYER_GENESIS_HASH:"0x"+"c".repeat(64),WORKER_RUN_SECONDS:"180"};
 const run=v=>spawnSync("bash",["-c",script],{env:{...good,...v},encoding:"utf8",timeout:5000});
 assert.equal(run({}).status,0,"Correct release preflight must succeed");
 for(const v of [{MAINNET_WORKER_ENABLED:"false"},{RELEASE_REF:"main"},{RELEASE_REF:"b".repeat(40)},{RELEASE_REF:"a".repeat(39)},{INTENTGUARD_SOURCE_COMMIT:""},{MONGODB_DB:"intentguard"},{APP_URL:""},{INTENTGUARD_RELEASE_ID:""},{INTENTGUARD_VERIFIED_MANIFEST:""},{INTENTGUARD_VERIFIED_MANIFEST_SHA256:""},{INTENTGUARD_VERIFIED_MANIFEST_SHA256:"b".repeat(63)},{GENLAYER_CONSENSUS_ADDRESS:""},{GENLAYER_GENESIS_HASH:""},{GENLAYER_GENESIS_HASH:"0x"+"c".repeat(63)},{WORKER_RUN_SECONDS:"0"},{WORKER_RUN_SECONDS:"241"},{WORKER_RUN_SECONDS:"180; echo injected"}])assert.notEqual(run(v).status,0,"Invalid preflight accepted "+Object.keys(v).join(","));
}

verifyWorkflows(workflows);checkGuard();
const mutable=new Map(workflows);mutable.set("worker.yml",workflows.get("worker.yml").replace(/actions\/checkout@[0-9a-f]{40}/,"actions/checkout@v4"));assert.throws(()=>verifyWorkflows(mutable));
const leak=new Map(workflows);leak.set("validate.yml",workflows.get("validate.yml")+"\n# regression $"+"{{ secrets.MONGODB_URI }}\n");assert.throws(()=>verifyWorkflows(leak));
const fallback=new Map(workflows);fallback.set("worker-mainnet.yml",workflows.get("worker-mainnet.yml").replace("secrets.MAINNET_MONGODB_URI","secrets.MONGODB_URI"));assert.throws(()=>verifyWorkflows(fallback));
const incompleteAudit=new Map(workflows);incompleteAudit.set("validate.yml",workflows.get("validate.yml").replace("run: pnpm audit\n","run: pnpm audit --prod\n"));assert.throws(()=>verifyWorkflows(incompleteAudit));
if(process.argv.includes("--structure")){console.log("WORKFLOW_STRUCTURE_VERIFIED");process.exit(0)}
assert.equal(process.platform,"linux","Pinned workflow linter requires Linux");
assert.equal(process.arch,"x64","Pinned workflow linter requires x64");
function command(binary,args,options={}){
 const r=spawnSync(binary,args,{encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024,...options});
 if(r.error||r.status!==0)throw Error(binary+" failed (exit "+r.status+"): "+(r.error?.message??[r.stderr,r.stdout].filter(Boolean).join("\n").slice(-12000)));return r.stdout.trim();
}

const temp=mkdtempSync(join(tmpdir(),"intentguard-workflows-"));
try{
 command("curl",["-fsSL","--max-time","30","--proto","=https","https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz","--output",join(temp,"actionlint.tar.gz")]);
 const archive=readFileSync(join(temp,"actionlint.tar.gz"));
 assert.equal(createHash("sha256").update(archive).digest("hex"),"8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8");
 command("tar",["-xzf",join(temp,"actionlint.tar.gz"),"-C",temp,"actionlint"]);
 command(join(temp,"actionlint"),["-shellcheck=","-pyflakes=",...[...workflows.keys()].map(n=>join(".github/workflows",n))]);
}finally{rmSync(temp,{recursive:true,force:true})}
console.log("WORKFLOWS_VERIFIED");
