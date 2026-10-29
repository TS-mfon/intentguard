import {IntentGuard} from "../packages/sdk";
import {paymentSchema} from "../packages/shared";
const base=process.env.INTENTGUARD_BASE_URL??process.env.INTENTGUARD_URL,key=process.env.INTENTGUARD_API_KEY,environment=process.env.INTENTGUARD_PAYMENT_ENV;
if(!base||!key||!environment||!["local","testnet","mainnet"].includes(environment))throw Error("Set INTENTGUARD_BASE_URL, explicit INTENTGUARD_PAYMENT_ENV and the agent's own INTENTGUARD_API_KEY");
const payment=paymentSchema.parse(JSON.parse(process.env.PAYMENT_JSON??"{}"));
const idempotency=process.env.IDEMPOTENCY_KEY;if(!idempotency)throw Error("Set the stable task idempotency key");
const agent=new IntentGuard({baseUrl:base,paymentEnvironment:environment as "local"|"testnet"|"mainnet",apiKey:key,frontendOrigin:process.env.INTENTGUARD_FRONTEND_ORIGIN,expectedReleaseId:process.env.INTENTGUARD_RELEASE_ID,expectedSourceCommit:process.env.INTENTGUARD_SOURCE_COMMIT,expectedCardId:process.env.INTENTGUARD_CARD_ID});const queued=await agent.request(payment,idempotency);
console.log("Queued request",queued);console.log("Final state",await agent.wait(queued.id));
