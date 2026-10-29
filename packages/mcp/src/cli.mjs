#!/usr/bin/env node
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {createProtocolServer} from "./server.mjs";
try{
 const server=createProtocolServer({baseUrl:process.env.INTENTGUARD_BASE_URL,paymentEnvironment:process.env.INTENTGUARD_PAYMENT_ENV,apiKey:process.env.INTENTGUARD_API_KEY||"",frontendOrigin:process.env.INTENTGUARD_FRONTEND_ORIGIN,sourceChainId:process.env.INTENTGUARD_SOURCE_CHAIN_ID?Number(process.env.INTENTGUARD_SOURCE_CHAIN_ID):undefined,expectedReleaseId:process.env.INTENTGUARD_EXPECTED_RELEASE_ID,expectedSourceCommit:process.env.INTENTGUARD_EXPECTED_SOURCE_COMMIT,expectedCardId:process.env.INTENTGUARD_EXPECTED_CARD_ID});
 await server.connect(new StdioServerTransport());
}catch{
 process.stderr.write("IntentGuard MCP could not start. Use Node 24, installed checkout dependencies, explicit INTENTGUARD_BASE_URL and INTENTGUARD_PAYMENT_ENV (testnet/mainnet/local). Check optional origin/release/card pins. Credentials are never printed.\n");
 process.exitCode=1;
}
