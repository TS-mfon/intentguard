#!/usr/bin/env node
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {createProtocolServer} from "./server.mjs";
try{
 const server=createProtocolServer({baseUrl:process.env.INTENTGUARD_BASE_URL||"https://intentguard-tapeout.vercel.app",apiKey:process.env.INTENTGUARD_API_KEY||""});
 await server.connect(new StdioServerTransport());
}catch{
 process.stderr.write("IntentGuard MCP could not start. Check Node >=22, installed dependencies and an HTTPS application origin. Credentials are never printed.\n");
 process.exitCode=1;
}
