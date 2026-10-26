import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const root=dirname(fileURLToPath(import.meta.url));
const artifact=(name,source=name)=>JSON.parse(readFileSync(resolve(root,"out",source+".sol",name+".json"),"utf8"));
const card=artifact("AgentSpendingCard"),factory=artifact("CardFactory");
const cctpCard=artifact("CctpSpendingCard"),cctpFactory=artifact("CctpCardFactory");
const local=artifact("LocalNandProcessor"),beacon=artifact("LocalProcessorBeacon","LocalNandProcessor");
const config=card.abi.find(entry=>entry.type==="constructor").inputs[0];
const releaseFields=[["requestId","bytes32"],["requestHash","bytes32"],["policyHash","bytes32"],
  ["evidenceHash","bytes32"],["decisionHash","bytes32"],["genLayerTxHash","bytes32"],["validUntil","uint64"]];
writeFileSync(resolve(root,"abi.json"),JSON.stringify({
  AgentSpendingCard:card.abi,CardFactory:factory.abi,LocalNandProcessor:local.abi,LocalProcessorBeacon:beacon.abi,
  CctpSpendingCard:cctpCard.abi,CctpCardFactory:cctpFactory.abi,
  configTuple:config,requestStatus:{NONE:0,RESERVED:1,PAID:2,CANCELLED:3,EXPIRED:4,BRIDGING:5},
  netlistHashAlgorithm:"SHA-256",
  release:{domain:{name:"IntentGuard",version:"1"},primaryType:"Release",fields:releaseFields},
  cctpDirectRelease:{domain:{name:"IntentGuard",version:"2"},primaryType:"Release",fields:releaseFields},
  bridgeRelease:{domain:{name:"IntentGuard",version:"2"},primaryType:"BridgeRelease",
    fields:[...releaseFields,["routeHash","bytes32"]]},
  bridgeReceipt:{domain:{name:"IntentGuard",version:"2"},primaryType:"BridgeReceipt",
    fields:[["requestId","bytes32"],["requestHash","bytes32"],["routeHash","bytes32"],["sourceTxHash","bytes32"],
      ["destinationTxHash","bytes32"],["messageHash","bytes32"],["amount","uint64"]]}
},null,2)+"\n");
console.log("ABI_EXPORTED");
