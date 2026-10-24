import {spawn} from "node:child_process";
import {readFile,writeFile,chmod} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {loadEnvFile} from "node:process";
import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";
const root=new URL("../",import.meta.url),envPath=new URL(".local/hosting.env",root);
const atlas=".local/atlas-cli/mongodb-atlas-cli_1.59.3_linux_x86_64/bin/atlas";
const project="6add0e4935a25d87d121f2ff",repo="TS-mfon/intentguard";
const action=process.argv[2];
async function run(command:string,args:string[],input?:string){
 return await new Promise<string>((resolve,reject)=>{
 const child=spawn(command,args,{cwd:root,stdio:["pipe","pipe","pipe"]});
 const output:Buffer[]=[];child.stdout.on("data",chunk=>output.push(chunk));child.stderr.resume();
 child.once("error",()=>reject(Error(command+" could not start")));
 child.once("close",code=>code===0?resolve(Buffer.concat(output).toString()):reject(Error(command+" "+args.slice(0,2).join(" ")+" failed with exit "+code)));
 child.stdin.end(input);
 });
}
if(action==="mongo"||action==="prepare"){
 let saved=await readFile(envPath,"utf8").catch(()=>"");
 if(!saved){
  const password=randomBytes(32).toString("hex");
  saved="MONGODB_URI=mongodb+srv://intentguard_app:"+password+"@intentguard.76osai5.mongodb.net/intentguard?retryWrites=true&w=majority\nMONGODB_DB=intentguard\nSESSION_SECRET="+randomBytes(32).toString("hex")+"\nDEMO_MERCHANT_ADMIN_KEY="+randomBytes(32).toString("hex")+"\nAPP_URL=https://intentguard-gen-daves-projects.vercel.app\n";
  await writeFile(envPath,saved,{mode:0o600});
 }
 await chmod(envPath,0o600);loadEnvFile(envPath);
 if(!process.env.DEMO_MERCHANT_RECIPIENT){const key=generatePrivateKey();await writeFile(envPath,saved+"DEMO_MERCHANT_PRIVATE_KEY="+key+"\nDEMO_MERCHANT_RECIPIENT="+privateKeyToAccount(key).address+"\n",{mode:0o600});loadEnvFile(envPath);}
 if(action==="prepare"){console.log("Private hosted demo credentials ready");process.exit(0);}
 const password=decodeURIComponent(new URL(process.env.MONGODB_URI!).password);
 const user={databaseName:"admin",username:"intentguard_app",password,roles:[{databaseName:"intentguard",roleName:"readWrite"}],scopes:[{name:"intentguard",type:"CLUSTER"}]};
 const response=JSON.parse(await run(atlas,["api","databaseUsers","createDatabaseUser","--groupId",project,"--profile","intentguard"],JSON.stringify(user)));
 if(response.username!=="intentguard_app")throw Error("Database user provisioning failed");
 console.log("Dedicated application database user created");
 await run(atlas,["accessLists","create","0.0.0.0/0","--type","cidrBlock","--comment","IntentGuard dedicated testnet demo: Vercel and GitHub dynamic egress","--projectId",project,"--profile","intentguard","--output","json"]);
 console.log("Dedicated demo cluster network access configured");
}else if(action==="github"||action==="vercel"){
 loadEnvFile(new URL(".local/testnet-secrets.env",root));loadEnvFile(envPath);
 const variables=["INTENTGUARD_MODE","XLAYER_CHAIN_ID","XLAYER_RPC_URL","PAYMENT_TOKEN","CARD_FACTORY_ADDRESS","GATEWAY_ADDRESS","ATTESTOR_ADDRESS","TAPEOUT_PROCESSOR","TAPEOUT_CIRCUIT_ID","TAPEOUT_BEACON","TAPEOUT_IMPLEMENTATION","TAPEOUT_NETLIST_HASH","GENLAYER_INTERPRETER_ADDRESS","GENLAYER_RPC_URL","MONGODB_DB","APP_URL",...(action==="vercel"?["DEMO_MERCHANT_RECIPIENT"]:[])];
 const secrets=action==="github"?["MONGODB_URI","XLAYER_OPERATOR_PRIVATE_KEY","REVIEW_ATTESTOR_PRIVATE_KEY","GENLAYER_OPERATOR_PRIVATE_KEY"]:["MONGODB_URI","SESSION_SECRET","DEMO_MERCHANT_ADMIN_KEY"];
 if(process.env.INTENTGUARD_MODE!=="testnet"||process.env.XLAYER_CHAIN_ID!=="1952")throw Error("Hosting configuration must be testnet");
 for(const name of [...variables,...secrets]){
  const value=process.env[name];if(!value)throw Error("Missing hosting setting "+name);
  if(action==="github")await run("gh",[secrets.includes(name)?"secret":"variable","set",name,"--repo",repo],value);
  else await run("npx",["--yes","vercel@latest","env","add",name,"production","--force"],value);
  console.log(action+" setting configured: "+name);
 }
}else throw Error("Use mongo, github or vercel");

