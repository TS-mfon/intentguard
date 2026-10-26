import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const root=dirname(fileURLToPath(import.meta.url));
const artifact=(name,source=name)=>JSON.parse(readFileSync(resolve(root,"out",source+".sol",name+".json"),"utf8"));
const card=artifact("AgentSpendingCard"),factory=artifact("CardFactory");
const cctpCard=artifact("CctpSpendingCard"),cctpFactory=artifact("CctpCardFactory");
const cctpCardV4=artifact("CctpSpendingCardV4"),cctpFactoryV4=artifact("CctpCardFactoryV4"),usdt0Factory=artifact("MainnetUsdt0CardFactory");
const local=artifact("LocalNandProcessor"),beacon=artifact("LocalProcessorBeacon","LocalNandProcessor");
const config=card.abi.find(entry=>entry.type==="constructor").inputs[0];
const releaseFields=[["requestId","bytes32"],["requestHash","bytes32"],["policyHash","bytes32"],
  ["evidenceHash","bytes32"],["decisionHash","bytes32"],["genLayerTxHash","bytes32"],["validUntil","uint64"]];
writeFileSync(resolve(root,"abi.json"),JSON.stringify({
  AgentSpendingCard:card.abi,CardFactory:factory.abi,LocalNandProcessor:local.abi,LocalProcessorBeacon:beacon.abi,
  CctpSpendingCard:cctpCard.abi,CctpCardFactory:cctpFactory.abi,
  CctpSpendingCardV4:cctpCardV4.abi,CctpCardFactoryV4:cctpFactoryV4.abi,MainnetUsdt0CardFactory:usdt0Factory.abi,
  configTuple:config,requestStatus:{NONE:0,RESERVED:1,PAID:2,CANCELLED:3,EXPIRED:4,BRIDGING:5},
  netlistHashAlgorithm:"SHA-256",
  release:{domain:{name:"IntentGuard",version:"1"},primaryType:"Release",fields:releaseFields},
  cctpDirectRelease:{domain:{name:"IntentGuard",version:"2"},primaryType:"Release",fields:releaseFields},
  bridgeRelease:{domain:{name:"IntentGuard",version:"2"},primaryType:"BridgeRelease",
    fields:[...releaseFields,["routeHash","bytes32"]]},
  cctpV4DirectRelease:{domain:{name:"IntentGuard",version:"4"},primaryType:"Release",fields:releaseFields},
  cctpV4BridgeRelease:{domain:{name:"IntentGuard",version:"4"},primaryType:"BridgeRelease",
    fields:[...releaseFields,["routeHash","bytes32"]]},
  cctpV4BridgeReceipt:{domain:{name:"IntentGuard",version:"4"},primaryType:"BridgeReceipt",
    fields:[["requestId","bytes32"],["requestHash","bytes32"],["routeHash","bytes32"],["sourceTxHash","bytes32"],
      ["destinationTxHash","bytes32"],["messageHash","bytes32"],["amount","uint64"]]},
  bridgeReceipt:{domain:{name:"IntentGuard",version:"2"},primaryType:"BridgeReceipt",
    fields:[["requestId","bytes32"],["requestHash","bytes32"],["routeHash","bytes32"],["sourceTxHash","bytes32"],
      ["destinationTxHash","bytes32"],["messageHash","bytes32"],["amount","uint64"]]}
},null,2)+"\n");
console.log("ABI_EXPORTED");
