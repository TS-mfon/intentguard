import {IntentGuard} from "../packages/sdk";
import {paymentSchema} from "../packages/shared";
const base=process.env.INTENTGUARD_URL,key=process.env.INTENTGUARD_API_KEY;
if(!base||!key)throw Error("Set INTENTGUARD_URL and the agent's own INTENTGUARD_API_KEY");
const payment=paymentSchema.parse(JSON.parse(process.env.PAYMENT_JSON??"{}"));
const idempotency=process.env.IDEMPOTENCY_KEY;if(!idempotency)throw Error("Set the stable task idempotency key");
const agent=new IntentGuard(base,key);const queued=await agent.request(payment,idempotency);
console.log("Queued request",queued);console.log("Final state",await agent.wait(queued.id));
