import {spawn} from "node:child_process";
import {loadEnvFile} from "node:process";
loadEnvFile(new URL("../.local/hosting.env",import.meta.url));
if(!process.env.MONGODB_URI)throw Error("Missing private database configuration");
const child=spawn("npx",["--yes","mongodb-mcp-server@1"],{stdio:["pipe","pipe","pipe"],env:{...process.env,MDB_MCP_CONNECTION_STRING:process.env.MONGODB_URI,MDB_MCP_READ_ONLY:"true"}});
child.stderr.resume();let buffer="",next=1;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
child.stdout.on("data",chunk=>{buffer+=chunk;while(buffer.includes("\n")){const at=buffer.indexOf("\n"),line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const response=JSON.parse(line);if(response.id){const item=pending.get(response.id);pending.delete(response.id);if(response.error)item?.reject(Error("MongoDB MCP request failed"));else item?.resolve(response.result)}}catch{}}});
function call(method:string,params:unknown={}){const id=next++;return new Promise<any>((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n")})}
const timeout=setTimeout(()=>{child.kill("SIGTERM");console.error("MongoDB MCP authentication check timed out");process.exit(1)},90000);
try{
 await call("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"intentguard-build-check",version:"1.0"}});
 child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
 const {tools}=await call("tools/list");
 const stats=tools.find((tool:any)=>tool.name==="db-stats");
 if(!stats)throw Error("MongoDB MCP database statistics tool unavailable");
 const result=await call("tools/call",{name:stats.name,arguments:{database:"intentguard"}});
 if(result.isError)throw Error("MongoDB MCP database authentication failed");
 console.log("MONGODB_MCP_AUTHENTICATED_DATABASE_CHECK_PASSED");
}finally{clearTimeout(timeout);child.kill("SIGTERM")}
