import {spawn} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {loadEnvFile} from "node:process";
const action=process.argv[2];
async function run(command:string,args:string[],input:string){return new Promise<void>((resolve,reject)=>{const child=spawn(command,args,{stdio:["pipe","pipe","pipe"]});child.stdout.resume();child.stderr.resume();child.once("error",()=>reject(Error("Host configuration command failed")));child.once("close",code=>code===0?resolve():reject(Error("Host configuration failed: "+command+" "+args.slice(0,2).join(" "))));child.stdin.end(input);});}
if(action==="merchant"){
 loadEnvFile(".local/hosting.env");const recipient=process.env.DEMO_MERCHANT_RECIPIENT,admin=process.env.DEMO_MERCHANT_ADMIN_KEY; if(!recipient||!admin)throw Error("Merchant environment missing.");
 await run("gh",["variable","set","DEMO_MERCHANT_RECIPIENT","--repo","TS-mfon/intentguard"],recipient);
 await run("gh",["secret","set","DEMO_MERCHANT_ADMIN_KEY","--repo","TS-mfon/intentguard"],admin);
 console.log("CCTP_AUDIT_MERCHANT_CONFIGURED");
}else if(action==="hosts"){
 const path=process.argv[3]??"docs/deployments/cctp.json",manifest=JSON.parse(await readFile(path,"utf8")),factory=manifest.factoryAddress;
 if(manifest.chainId!==1952||!/^0x[0-9a-fA-F]{40}$/.test(factory??""))throw Error("Verified testnet factory manifest required.");
 await run("gh",["variable","set","CCTP_CARD_FACTORY_ADDRESS","--repo","TS-mfon/intentguard"],factory);
 await run("vercel",["env","add","CCTP_CARD_FACTORY_ADDRESS","production","--force"],factory);
 const env=await readFile(".local/testnet-secrets.env","utf8");
 const next=env.includes("CCTP_CARD_FACTORY_ADDRESS=")?env.replace(/^CCTP_CARD_FACTORY_ADDRESS=.*$/m,"CCTP_CARD_FACTORY_ADDRESS="+factory):env+"CCTP_CARD_FACTORY_ADDRESS="+factory+"\n";
 await writeFile(".local/testnet-secrets.env",next,{mode:0o600});
 console.log("CCTP_FACTORY_HOSTS_CONFIGURED",factory);
}else throw Error("Use merchant or hosts [verified-manifest-path].");
