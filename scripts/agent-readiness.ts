import {loadEnvFile} from "node:process";
import {database} from "../apps/web/lib/store";
import {GenLayer,PendingFinality} from "../apps/web/lib/genlayer";
import {Evm} from "../apps/web/lib/evm";
import type {Card} from "../apps/web/lib/models";
loadEnvFile(".local/testnet-secrets.env");loadEnvFile(".local/hosting.env");
const id=process.argv[2],wait=process.argv.includes("--wait"),deadline=Date.now()+600000;
try{
 const store=await database(),gl=new GenLayer(store),evm=new Evm(store);let previous="";
 while(true){
  const card=await store.get<Card>("cards",id);if(!card)throw Error("Agent not registered");
  const view=await evm.view(card);
  const summary={id:card._id,address:card.address,state:card.state,status:view.status,reviewerTx:card.reviewerTx,reviewerAddress:card.reviewerAddress,balances:view.balances,financial:card.policy.financial,criteria:card.policy.criteria.map(c=>c.id),error:card.error};
  const output=JSON.stringify(summary);if(output!==previous){console.log(output);previous=output;}
  if(card.state==="READY"){
   const address=await gl.reviewer(card);if(address.toLowerCase()!==card.reviewerAddress?.toLowerCase())throw Error("Reviewer address mismatch");
   console.log("AGENT_REVIEWER_READY_AND_VERIFIED");process.exit(0);
  }
  if(card.reviewerTx)try{await gl.reviewer(card);console.log("REVIEWER_FINALIZED_AWAITING_WORKER_REGISTRATION");}catch(e){if(!(e instanceof PendingFinality))console.log("REVIEWER_VERIFICATION_RETRY_REQUIRED");}
  if(!wait||Date.now()>deadline){console.log("AGENT_REVIEWER_PENDING");process.exit(2);}
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}catch{console.error("AGENT_READINESS_CHECK_FAILED");process.exit(1);}
