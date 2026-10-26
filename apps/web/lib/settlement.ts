import {settlementSchema,digest,type Settlement,type CanonicalRequest,type PaymentInput} from "../../../packages/shared";
import {CCTP_TESTNETS} from "../../../packages/shared/assets";
import {ApiError} from "./errors";
import {configuration} from "./config";
import type {Card} from "./models";
export function normalizeSettlement(value:unknown):Settlement|undefined{
 if(value===undefined)return undefined;
 const parsed=settlementSchema.safeParse(value);
 if(!parsed.success)throw new ApiError(422,"ASSET_OR_ROUTE_UNSUPPORTED","Choose native USDC and at least one of X Layer Testnet, Base Sepolia or Arbitrum Sepolia. USDT0 has no verified deployment on X Layer testnet.",parsed.error.issues.map(i=>({field:"settlement."+i.path.join("."),code:i.code,message:i.message})));
 return parsed.data;
}
export function settlementFactory(s?:Settlement){const c=configuration();if(!s)return c.factoryAddress;
 if(!c.testnet||c.chainId!==1952)throw new ApiError(422,"TESTNET_REQUIRED","USDC cross-chain cards require X Layer testnet chain 1952.");
 const address=process.env.CCTP_CARD_FACTORY_ADDRESS;
 if(!/^0x[0-9a-fA-F]{40}$/.test(address??"")||/^0x0{40}$/.test(address!))throw new ApiError(503,"BRIDGE_NOT_CONFIGURED","USDC card deployment is not configured yet. Preserve the draft and retry.",undefined,30);
 return address!;
}
export function destinationDomains(s:Settlement){return s.destinationChainIds.map(id=>CCTP_TESTNETS[id].domain)}
export function cardSymbol(c:Card){return c.settlement?"USDC":Number(c.chainId??configuration().chainId)===1952?"TEST-USDT":"USDT"}
export function paymentDestination(c:Card,input:PaymentInput){
 const source=Number(c.chainId??configuration().chainId),destination=input.destinationChainId??source;
 if(!c.settlement){if(destination!==source)throw new ApiError(422,"DESTINATION_NOT_ALLOWED","This legacy card permits spending only on its immutable source chain. Create a USDC card for cross-chain spending.");return {chainId:source,token:String(c.token??configuration().token).toLowerCase(),domain:undefined};}
 if(source!==1952||String(c.token).toLowerCase()!==CCTP_TESTNETS[1952].token.toLowerCase())throw new ApiError(409,"ASSET_CONFIGURATION_MISMATCH","The card token is inconsistent with its committed settlement configuration.");
 if(!c.settlement.destinationChainIds.includes(destination as 1952|84532|421614))throw new ApiError(422,"DESTINATION_NOT_ALLOWED","The owner did not approve this destination testnet.");
 const route=CCTP_TESTNETS[destination as keyof typeof CCTP_TESTNETS];
 if(!route)throw new ApiError(422,"DESTINATION_NOT_ALLOWED","Unsupported destination testnet.");
 return {chainId:route.chainId,token:route.token.toLowerCase(),domain:route.domain};
}
export function canonicalDestination(c:Card,input:PaymentInput):Partial<CanonicalRequest>{
 const d=paymentDestination(c,input);return c.settlement?{settlementHash:digest(c.settlement),destinationChainId:d.chainId,destinationToken:d.token,destinationDomain:d.domain}:input.destinationChainId!==undefined?{destinationChainId:d.chainId}:{};
}
export function isBridge(c:Card,p:{canonical?:CanonicalRequest;input:PaymentInput}){return !!c.settlement&&paymentDestination(c,p.canonical??p.input).chainId!==1952}
