import {readFile,writeFile} from "node:fs/promises";
const file=new URL("../../../docs/openapi.json",import.meta.url),o=JSON.parse(await readFile(file,"utf8"));
o.info.version="0.2.0";o.info.description="Owner-approved testnet vaults. TapeOut gates reservation/settlement on X Layer 1952; GenLayer Studionet 61999 reviews evidence. PAID alone confirms transfer. Complete protocol and MCP resources are bundled.";
o.servers=[{url:"/api/v1"},{url:"https://intentguard-tapeout.vercel.app/api/v1",description:"Canonical testnet deployment"}];
const s=o.components.schemas,ref=name=>({$ref:"#/components/schemas/"+name});
s.Error.properties.error.properties={code:{type:"string"},message:{type:"string"},retryable:{type:"boolean"},requestId:{type:"string"},details:{type:"array",items:{type:"object",properties:{field:{type:"string"},code:{type:"string"},message:{type:"string"}},required:["field","code","message"],additionalProperties:false}}};
s.Error.properties.error.required=["code","message","retryable","requestId"];
s.ReviewStage={type:"object",properties:{status:{enum:["PENDING","COMPLETE","SKIPPED","FAILED"]},reason:{type:"string"}},required:["status","reason"],additionalProperties:false};
s.RequestView.properties.reviewStage=ref("ReviewStage");s.PublicTransaction.properties.reviewStage=ref("ReviewStage");
const detail=o.paths["/explorer/transactions/{id}"].get.responses["200"].content["application/json"].schema;
detail.properties.reasoningSource.enum=["genlayer-finalized-contract","pending","unavailable","skipped","failed"];
detail.properties.reviewStage=ref("ReviewStage");detail.required=[...new Set([...detail.required,"reviewStage"])];
s.AgentUsage={type:"object",description:"Actual admitted operations; identical retries do not inflate counts. fundsMoved sums PAID records only. Timestamped snapshot, not solvency proof.",properties:Object.fromEntries(["requestCount","paidCount","blockedCount","rejectedCount","needsEvidenceCount","cancelledCount","activeCount"].map(k=>[k,{type:"integer",minimum:0}]))};
Object.assign(s.AgentUsage.properties,{fundsMoved:{type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",description:"Exact configured-token sum of PAID amounts"},token:{type:"string",pattern:"^0x[0-9a-fA-F]{40}$"},chainId:{type:"integer"},asOf:{type:"integer",description:"Snapshot Unix milliseconds"}});
s.AgentUsage.required=Object.keys(s.AgentUsage.properties);
s.AgentCardSnapshot={type:"object",properties:{agent:ref("PublicAgent"),usage:ref("AgentUsage"),shareUrl:{type:"string",format:"uri"}},required:["agent","usage","shareUrl"]};
const param={name:"id",in:"path",required:true,schema:{type:"string",pattern:"^0x[0-9a-fA-F]{64}$"}};
const error={description:"Structured machine error; inspect code, retryable, requestId and optional field details",content:{"application/json":{schema:ref("Error")}}};
o.paths["/explorer/agents/{id}/card"]={get:{operationId:"publicAgentCard",description:"Actual identity and cumulative usage snapshot. No credentials.",security:[],parameters:[param],responses:{"200":{description:"Actual admitted counts and PAID funds only",content:{"application/json":{schema:ref("AgentCardSnapshot")}}},default:structuredClone(error)}}};
o.paths["/explorer/agents/{id}/card.svg"]={get:{operationId:"downloadAgentCard",description:"Standalone downloadable SVG ATM card with actual identity/usage/time and no private keys or invoices.",security:[],parameters:[param],responses:{"200":{description:"Scalable ATM card image attachment",headers:{"Content-Disposition":{schema:{type:"string"},description:"attachment; filename=..."}},content:{"image/svg+xml":{schema:{type:"string"}}}},default:structuredClone(error)}}};
for(const[path,verbs]of Object.entries(o.paths))for(const[method,op]of Object.entries(verbs)){
 for(const[status,response]of Object.entries(op.responses)){
  response.headers={...response.headers,"X-Request-Id":{description:"Request correlation identifier",schema:{type:"string"}}};
  if(status==="default")response.headers["Retry-After"]={description:"Seconds before appropriate retry; absent for nonretryable errors",schema:{type:"integer",minimum:1}};
  if(Number(status)<300&&(op.security||[]).some(v=>"AgentKey"in v||"OwnerSession"in v))for(const name of ["RateLimit-Limit","RateLimit-Remaining","RateLimit-Reset","RateLimit-Policy"])response.headers[name]={description:name==="RateLimit-Reset"?"Seconds to next fixed minute":"Authenticated fixed-minute quota metadata",schema:{type:"string"}};
 }
 op.responses["405"]={...structuredClone(error),description:"Recognized route, wrong method",headers:{"Allow":{schema:{type:"string"}},"X-Request-Id":{schema:{type:"string"}}}};
 if(op.requestBody){
  op.responses["400"]={...structuredClone(error),description:"INVALID_JSON: missing/malformed JSON"};
  op.responses["415"]={...structuredClone(error),description:"UNSUPPORTED_MEDIA_TYPE: use application/json"};
  op.responses["413"]={...structuredClone(error),description:"BODY_TOO_LARGE"};
  op.responses["422"]={...structuredClone(error),description:"Invalid schema, amounts, evidence or activation"};
 }
 if(path.startsWith("/owner/")||path==="/me"||path.startsWith("/requests"))op.responses["429"]={...structuredClone(error),description:"RATE_LIMIT: fixed-minute quota exceeded",headers:{"Retry-After":{schema:{type:"integer",minimum:1}},"X-Request-Id":{schema:{type:"string"}}}};
}

o.info.version="0.3.0";
o.info.description="Owner-approved testnet vaults: native X Layer USDC with permitted CCTP V2 payments on Base Sepolia/Arbitrum Sepolia; legacy TEST-USDT agents are preserved. TapeOut and finalized GenLayer approval precede source burn. Only PAID confirms destination delivery. USDT0 remains unsupported on testnet.";
const addressSchema={type:"string",pattern:"^0x[0-9a-fA-F]{40}$"},hashSchema={type:"string",pattern:"^0x[0-9a-fA-F]{64}$"},amountSchema={type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",description:"Exact six-decimal positive token amount within uint64 atomic units; never a JSON number."};
const lifecycle=["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED","RETRYING","BRIDGING","AWAITING_ATTESTATION","MINTING"];
s.Settlement={type:"object",additionalProperties:false,properties:{asset:{const:"USDC",type:"string"},destinationChainIds:{type:"array",minItems:1,maxItems:3,uniqueItems:true,items:{type:"integer",enum:[1952,84532,421614]},description:"Owner-approved spending testnets. Canonical commitment sorts these IDs. Chain1952 must be included to allow direct source-chain payments."}},required:["asset","destinationChainIds"]};
s.BridgeView={type:"object",additionalProperties:false,properties:{protocol:{const:"CCTP_V2",type:"string"},phase:{type:"string",enum:["BURNED","ATTESTATION_PENDING","ATTESTED","MINT_SUBMITTED","CONFIRMED"]},sourceChainId:{const:1952,type:"integer"},destinationChainId:{type:"integer",enum:[84532,421614]},destinationDomain:{type:"integer",enum:[6,3]},sourceToken:addressSchema,destinationToken:addressSchema,amount:amountSchema,sourceTxHash:hashSchema,messageHash:hashSchema,nonce:hashSchema,destinationTxHash:hashSchema,confirmationTxHash:hashSchema,updatedAt:{type:"integer",description:"Unix milliseconds"}},required:["protocol","phase","sourceChainId","destinationChainId","destinationDomain","sourceToken","destinationToken","amount","sourceTxHash","updatedAt"],description:"Actual persisted CCTP progress; absent before a verified burn. A burn/attestation/mint submission is not PAID; destination receipt and source acknowledgement must be verified. Never initiate a second burn during recovery."};
s.TestnetAsset={type:"object",additionalProperties:false,properties:{asset:{enum:["USDC","USDT0"]},symbol:{type:"string"},chainId:{const:1952,type:"integer"},decimals:{const:6,type:"integer"},token:{anyOf:[addressSchema,{type:"null"}]},available:{type:"boolean"},reason:{type:"string"},sources:{type:"array",items:{type:"string",format:"uri"}}},required:["asset","symbol","chainId","decimals","token","available","reason","sources"]};
s.SpendingNetwork={type:"object",additionalProperties:false,properties:{chainId:{type:"integer",enum:[1952,84532,421614]},name:{type:"string"},domain:{type:"integer",enum:[37,6,3]},token:addressSchema,explorerUrl:{type:"string",format:"uri"}},required:["chainId","name","domain","token","explorerUrl"]};
Object.assign(s.Config.properties,{assets:{type:"array",items:ref("TestnetAsset")},spendingNetworks:{type:"array",items:ref("SpendingNetwork")},cctpFactoryAddress:{anyOf:[addressSchema,{type:"null"}],description:"Native USDC card factory; null means activation unavailable, even when issuer routes are verified."}});
s.Config.required=[...new Set([...s.Config.required,"assets","spendingNetworks","cctpFactoryAddress"])];
s.Config.properties.token.description="Legacy configured token. Obtain each agent's actual token from /me or CardView; do not use this global token to fund a USDC card.";
s.Config.properties.paymentSymbol.description="Legacy global token label. Agent and transaction paymentSymbol identify their actual asset.";
for(const name of ["CardView","PublicAgent"]){Object.assign(s[name].properties,{settlement:ref("Settlement"),paymentSymbol:{type:"string",description:"Actual card asset: USDC for native CCTP cards, TEST-USDT for existing testnet vaults."}});}
s.PublicAgent.properties.usage=ref("AgentUsage");
s.CardView.properties.balances.properties.spent.description="Lifetime amount paid directly or burned through CCTP. Bridge burn consumes budget before merchant delivery.";
s.CardView.properties.balances.properties.periodSpent.description="Paid or burned amount attributed to the original reservation period when it is the current period.";
s.CardView.properties.balances.properties.funded.description="Current actual source-vault token balance; decreases on direct payment, burn or withdrawal. Not cumulative deposits.";
s.DraftView.properties.settlement=ref("Settlement");
Object.assign(s.DraftView.properties.activation.properties,{kind:{const:"CCTP_V2",type:"string"},destinationDomains:{type:"array",minItems:1,maxItems:3,uniqueItems:true,items:{type:"integer",enum:[37,6,3]}},settlement:ref("Settlement")});
s.DraftView.properties.activation.description="Exact verified factory input. CCTP_V2 activation supplies selected domains37(source),6(Base),3(Arbitrum). Missing kind preserves legacy factory activation.";
s.PaymentInput.properties.amount=amountSchema;
s.PaymentInput.properties.destinationChainId={type:"integer",minimum:1,description:"Optional spending EVM chain ID; defaults to this card's source chain. The owner must have approved it. Supported native USDC targets1952,84532,421614; never CCTP domain IDs."};
for(const name of ["RequestView","PublicTransaction"]){s[name].properties.status.enum=lifecycle;Object.assign(s[name].properties,{bridge:ref("BridgeView"),paymentSymbol:{type:"string"},errorCode:{type:name==="PublicTransaction"?["string","null"]:"string"}});s[name].properties.paymentTxHash.description="Confirmed recipient delivery transaction: source chain for direct payments, destination chain for CCTP. Do not open a Base/Arbitrum hash on X Layer.";}
Object.assign(s.PublicTransaction.properties,{destinationChainId:{type:"integer",minimum:1},destinationToken:addressSchema});
s.AgentUsage.description="Actual admitted operations. activeCount includes bridge reconciliation. fundsMoved sums PAID delivery only across allowed testnets in the same issuer asset; a burn is excluded until delivery.";
s.AgentUsage.properties.fundsMoved.description="Exact sum of this agent's PAID amounts in its immutable token. Pending burns are excluded.";
s.AgentUsage.properties.chainId.description="Source vault chain. Delivery may occur on allowed destination chains; inspect the individual bridge record.";
const draft=o.paths["/owner/drafts"].post.requestBody.content["application/json"].schema;
draft.properties.settlement=ref("Settlement");
o.paths["/owner/drafts"].post.description="Propose immutable policy. Supply settlement for new native USDC cards. Omission preserves legacy configured-token behavior. Asset and approved destination IDs are stored separately from semantic proposal and verified at factory activation/reviewer deployment.";
const merchant=o.paths["/demo/invoices"].post.requestBody.content["application/json"].schema;
Object.assign(merchant.properties,{chainId:{type:"integer",minimum:1,description:"Invoice delivery chain. Supply together with token; omission of both retains legacy configured-token invoices."},token:{...addressSchema,description:"Official native USDC on the chosen testnet, or the legacy configured source token."}});
o.paths["/demo/invoices"].post.description="Separate merchant-admin credential issues a real testnet invoice. Supply chainId+token together for USDC; destination chain/token must match eventual payment delivery. Agent keys cannot issue invoices.";
o.paths["/requests"].post.description="Admit one credential-bound payment with a stable Idempotency-Key. Destination defaults to source; unsupported/unapproved destinations are rejected before admission. Cross-chain source burns occur only after guard plus finalized review. HTTP202,APPROVED,burn,attestation or submitted mint do not mean delivery.";
o.paths["/requests/{id}"].get.description="Inspect this credential's payment and bridge progress. Keep polling the same ID for BRIDGING/AWAITING_ATTESTATION/MINTING. PAID requires verified destination mint plus source acknowledgement. Revoking credentials cannot cancel an existing burn.";
for(const[name,field]of [["Policy","totalBudget"],["Policy","perPaymentLimit"],["Policy","periodBudget"]])s[name].properties.financial.properties[field]=amountSchema;
for(const verbs of Object.values(o.paths))for(const op of Object.values(verbs)){
 for(const response of Object.values(op.responses)){const props=response.content?.["application/json"]?.schema?.properties;if(props?.status?.enum&&props.status.enum.includes("QUEUED"))props.status.enum=lifecycle;}
}
for(const field of o.paths["/explorer/transactions"].get.parameters||[]){if(field.name==="status")field.schema.enum=lifecycle;}

await writeFile(file,JSON.stringify(o,null,2)+"\n");
console.log("Protocol schema updated");
