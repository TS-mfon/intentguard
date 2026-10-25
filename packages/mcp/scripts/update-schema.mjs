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
await writeFile(file,JSON.stringify(o,null,2)+"\n");
console.log("Protocol schema updated");
