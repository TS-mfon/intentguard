import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const root=dirname(fileURLToPath(import.meta.url));
const artifact=(name,source=name)=>JSON.parse(readFileSync(resolve(root,"out",source+".sol",name+".json"),"utf8"));
const card=artifact("AgentSpendingCard"),factory=artifact("CardFactory");
const local=artifact("LocalNandProcessor"),beacon=artifact("LocalProcessorBeacon","LocalNandProcessor");
const config=card.abi.find(entry=>entry.type==="constructor").inputs[0];
writeFileSync(resolve(root,"abi.json"),JSON.stringify({
  AgentSpendingCard:card.abi,CardFactory:factory.abi,LocalNandProcessor:local.abi,LocalProcessorBeacon:beacon.abi,
  configTuple:config,requestStatus:{NONE:0,RESERVED:1,PAID:2,CANCELLED:3,EXPIRED:4},
  netlistHashAlgorithm:"SHA-256",
  release:{domain:{name:"IntentGuard",version:"1"},primaryType:"Release",
    fields:[["requestId","bytes32"],["requestHash","bytes32"],["policyHash","bytes32"],
      ["evidenceHash","bytes32"],["decisionHash","bytes32"],["genLayerTxHash","bytes32"],["validUntil","uint64"]]}
},null,2)+"\n");
console.log("ABI_EXPORTED");
