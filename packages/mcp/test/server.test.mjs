import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {createProtocolServer} from "../src/server.mjs";

const hash="0x"+"12".repeat(32),other="0x"+"13".repeat(32),key="ig_controlled_mcp_test_credential";
const payment={recipient:"0x"+"34".repeat(20),amount:"1.000001",purchaseDescription:"Approved protocol data",justification:"Required by the owner-approved research mission",category:"data",invoiceId:"actual-test-invoice",evidence:[{url:"https://merchant.example/invoice.json"}]};
test("real stdio MCP handshake, self-contained resources, idempotent payment and terminal/error behavior",{timeout:60000},async()=>{
 let submitted,requestCount=0,networkCount=0,state="QUEUED",malformed=false;
 const headersSeen=[];
 const api=createServer(async(req,res)=>{
  networkCount++;headersSeen.push({path:req.url,headers:req.headers});
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  res.setHeader("Content-Type","application/json");res.setHeader("X-Request-Id","controlled-correlation-id");
  const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value))};
  if(req.url==="/api/v1/config")return send(200,{chainId:1952,paymentSymbol:"TEST-USDT",configured:true});
  if(req.url?.startsWith("/api/v1/explorer/agents?"))return send(200,{agents:[],nextCursor:null});
  if(req.url==="/api/v1/explorer/agents/"+hash+"/card")return send(200,{agent:{id:hash},usage:{requestCount,fundsMoved:state==="PAID"?"1.000001":"0",asOf:Date.now()},shareUrl:"https://intentguard-tapeout.vercel.app/explorer?agentId="+hash});
  if(req.headers.authorization!=="Bearer "+key)return send(401,{error:{code:"KEY_REQUIRED",message:"Credential required",retryable:false}});
  if(req.url==="/api/v1/me"){
   if(malformed){res.setHeader("Content-Type","text/html");res.end("<html>Unavailable</html>");return;}
   return send(200,{card:{id:hash,status:"ACTIVE",policy:{mission:"Approved research"},balances:{spent:"0"}},serverEcho:key});
  }
  if(req.url==="/api/v1/requests"&&req.method==="POST"){
   assert.equal(req.headers["content-type"],"application/json");
   assert.equal(req.headers["idempotency-key"],"stable-operation");
   if(submitted&&JSON.stringify(body)!==JSON.stringify(submitted))return send(409,{error:{code:"IDEMPOTENCY_CONFLICT",message:"Input changed "+key,retryable:false,requestId:"conflict-id"}});
   if(!submitted){submitted=body;requestCount++;}
   return send(202,{id:hash,status:state});
  }
  if(req.url==="/api/v1/requests/"+hash)return send(200,{id:hash,status:state,...(state==="PAID"?{paymentTxHash:other}:{})});
  if(req.url==="/api/v1/requests/"+other){res.setHeader("Retry-After","9");return send(404,{error:{code:"NOT_FOUND",message:"Request not found",retryable:false,requestId:"missing-id"}});}
  send(404,{error:{code:"NOT_FOUND",message:"Not found"}});
 });
 await new Promise(r=>api.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+api.address().port;
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL("../src/cli.mjs",import.meta.url))],env:{...process.env,INTENTGUARD_BASE_URL:base,INTENTGUARD_API_KEY:key},stderr:"pipe"});
 let stderr="";transport.stderr?.on("data",c=>stderr+=c.toString());
 const client=new Client({name:"intentguard-test-client",version:"1.0.0"});
 try{
  await client.connect(transport);
  const tools=await client.listTools();const names=tools.tools.map(t=>t.name);
  for(const name of ["get_config","get_my_agent","submit_payment","get_payment","wait_for_payment","get_agent_card","get_transaction"])assert.ok(names.includes(name));
  const submitTool=tools.tools.find(t=>t.name==="submit_payment");assert.equal(submitTool.annotations.readOnlyHint,false);assert.equal(submitTool.annotations.destructiveHint,true);
  const resources=await client.listResources();assert.equal(resources.resources.length,2);
  const protocol=await client.readResource({uri:"intentguard://protocol"});assert.match(protocol.contents[0].text,/Only payment status PAID/);assert.match(protocol.contents[0].text,/Idempotency-Key/);
  const schema=await client.readResource({uri:"intentguard://openapi"});assert.equal(JSON.parse(schema.contents[0].text).openapi,"3.1.0");
  const prompts=await client.listPrompts();assert.equal(prompts.prompts[0].name,"payment_integration");
  const config=await client.callTool({name:"get_config",arguments:{}});assert.equal(config.structuredContent.data.chainId,1952);assert.equal(headersSeen.at(-1).headers.authorization,undefined);
  await client.callTool({name:"list_agents",arguments:{limit:3}});assert.equal(headersSeen.at(-1).headers.authorization,undefined);assert.match(headersSeen.at(-1).path,/limit=3/);
  const me=await client.callTool({name:"get_my_agent",arguments:{}});assert.equal(me.structuredContent.ok,true);assert.equal(me.structuredContent.data.serverEcho,"[REDACTED]");assert.equal(JSON.stringify(me).includes(key),false);assert.equal(headersSeen.at(-1).headers.authorization,"Bearer "+key);
  const before=networkCount;
  for(const bad of [{...payment,amount:"0"},{...payment,amount:"1.0000001"},{...payment,amount:"not-a-number"},{...payment,cardId:other},{...payment,evidence:[payment.evidence[0],payment.evidence[0]]}]){
   const result=await client.callTool({name:"submit_payment",arguments:{payment:bad,idempotencyKey:"stable-operation"}});assert.equal(result.isError,true);
  }
  assert.equal(networkCount,before,"Invalid payment never reaches HTTP");
  const first=await client.callTool({name:"submit_payment",arguments:{payment,idempotencyKey:"stable-operation"}});assert.equal(first.structuredContent.status,202);assert.equal(first.structuredContent.data.id,hash);
  const retry=await client.callTool({name:"submit_payment",arguments:{payment,idempotencyKey:"stable-operation"}});assert.equal(retry.structuredContent.data.id,hash);assert.equal(requestCount,1);
  const conflict=await client.callTool({name:"submit_payment",arguments:{payment:{...payment,amount:"2"},idempotencyKey:"stable-operation"}});assert.equal(conflict.isError,true);assert.equal(conflict.structuredContent.error.code,"IDEMPOTENCY_CONFLICT");assert.equal(conflict.structuredContent.error.status,409);assert.equal(conflict.structuredContent.error.requestId,"conflict-id");assert.equal(JSON.stringify(conflict).includes(key),false);
  const pending=await client.callTool({name:"wait_for_payment",arguments:{id:hash,maxWaitMs:0}});assert.equal(pending.structuredContent.pending,true);assert.equal(pending.structuredContent.operationId,hash);assert.equal(requestCount,1);
  for(const terminal of ["PAID","BLOCKED","REJECTED","NEEDS_EVIDENCE","EXPIRED","CANCELLED"]){state=terminal;const result=await client.callTool({name:"wait_for_payment",arguments:{id:hash,maxWaitMs:100}});assert.equal(result.structuredContent.data.status,terminal);assert.equal(result.structuredContent.pending,undefined);}
  const missing=await client.callTool({name:"get_payment",arguments:{id:other}});assert.equal(missing.structuredContent.error.code,"NOT_FOUND");assert.equal(missing.structuredContent.error.status,404);assert.equal(missing.structuredContent.error.retryable,false);assert.equal(missing.structuredContent.error.requestId,"missing-id");
  state="PAID";const card=await client.callTool({name:"get_agent_card",arguments:{id:hash}});assert.equal(card.structuredContent.data.usage.requestCount,1);assert.equal(card.structuredContent.data.usage.fundsMoved,"1.000001");assert.equal(headersSeen.at(-1).headers.authorization,undefined);
  malformed=true;const nonJson=await client.callTool({name:"get_my_agent",arguments:{}});assert.equal(nonJson.isError,true);assert.equal(nonJson.structuredContent.error.code,"INVALID_RESPONSE");
  assert.equal(stderr.includes(key),false);
 }finally{await client.close();await new Promise(r=>api.close(r));}
});
test("base URL constraints reject insecure remote endpoints and embedded secrets",()=>{
 for(const baseUrl of ["http://example.com","https://name:password@example.com","https://example.com/api","https://example.com/?token=sensitive","file:///tmp"]){assert.throws(()=>createProtocolServer({baseUrl}));}
 assert.ok(createProtocolServer({baseUrl:"https://intentguard-tapeout.vercel.app"}));
});
test("missing credentials produce an actionable error without HTTP admission",{timeout:15000},async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL("../src/cli.mjs",import.meta.url))],env:{...process.env,INTENTGUARD_BASE_URL:"https://intentguard-tapeout.vercel.app",INTENTGUARD_API_KEY:""},stderr:"pipe"});
 const client=new Client({name:"no-key-client",version:"1.0.0"});try{await client.connect(transport);const result=await client.callTool({name:"get_my_agent",arguments:{}});assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,"KEY_REQUIRED");assert.equal(result.structuredContent.error.status,401);}finally{await client.close();}
});
