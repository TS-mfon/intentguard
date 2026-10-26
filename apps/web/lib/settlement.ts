import {settlementSchema,settlementV2Schema,isSettlementV2,digest,type Settlement,type CanonicalRequest,type PaymentInput} from "../../../packages/shared";
import {CCTP_TESTNETS} from "../../../packages/shared/assets";
import {paymentRoute,sourceToken,SOURCE_CHAIN_IDS} from "../../../packages/shared/payment-profiles";
import {ApiError} from "./errors";
import {configuration} from "./config";
import {runtimeManifest} from "./deployment-profile";
import type {Card} from "./models";
export function normalizeSettlement(value:unknown):Settlement|undefined{
 const cfg=configuration();
 if(value===undefined){if(cfg.mainnet)throw new ApiError(422,"SETTLEMENT_PROFILE_REQUIRED","Choose an explicit mainnet USDC or USDT0 settlement profile.");return undefined;}
 const v2=!!value&&typeof value==="object"&&"version" in value;
 const parsed=v2?settlementV2Schema.safeParse(value):settlementSchema.safeParse(value);
 if(!parsed.success)throw new ApiError(422,"ASSET_OR_ROUTE_UNSUPPORTED","Choose native USDC destinations in this payment environment, or mainnet X Layer USDT0 only.",parsed.error.issues.map(i=>({field:"settlement."+i.path.join("."),code:i.code,message:i.message})));
 const s=parsed.data;
 if(isSettlementV2(s)?s.paymentEnvironment!==cfg.paymentEnvironment:cfg.mainnet)throw new ApiError(422,"PAYMENT_ENVIRONMENT_MISMATCH","Settlement permissions belong to another payment environment.");
 return s;
}
export function settlementFactory(s?:Settlement){
 const c=configuration();if(!s)return c.factoryAddress;
 if(!isSettlementV2(s)){if(!c.testnet||c.chainId!==1952)throw new ApiError(422,"TESTNET_REQUIRED","Legacy USDC permissions require X Layer testnet1952.");}
 else if(s.paymentEnvironment!==c.paymentEnvironment||c.chainId!==SOURCE_CHAIN_IDS[s.paymentEnvironment])throw new ApiError(422,"PAYMENT_ENVIRONMENT_MISMATCH","Settlement and runtime profiles differ.");
 const factory=isSettlementV2(s)&&s.asset==="USDT0"?c.factoryAddress:process.env.CCTP_CARD_FACTORY_ADDRESS;
 if(!/^0x[0-9a-fA-F]{40}$/.test(factory??"")||/^0x0{40}$/.test(factory!))throw new ApiError(503,"BRIDGE_NOT_CONFIGURED","The selected asset factory is not deployed and verified yet.",undefined,30);
 return factory!;
}
export async function assertSettlementReady(s?:Settlement){
 if(!s||!isSettlementV2(s))return;
 const manifest=await runtimeManifest();
 if(!manifest.enabledAssets.includes(s.asset)||s.destinationChainIds.some(id=>!manifest.verifiedDestinationChainIds.includes(id)))throw new ApiError(503,"ASSET_OR_ROUTE_NOT_VERIFIED","The requested asset and every selected route must have release-pinned issuer verification.");
}
export function settlementToken(s?:Settlement){const c=configuration();return s?(isSettlementV2(s)?sourceToken(s.paymentEnvironment,s.asset):CCTP_TESTNETS[1952].token):c.token;}
export function destinationDomains(s:Settlement){return s.destinationChainIds.map(id=>isSettlementV2(s)?(s.asset==="USDT0"?37:paymentRoute(s.paymentEnvironment,id).domain):CCTP_TESTNETS[id].domain);}
export function cardSymbol(c:Card){return c.settlement?c.settlement.asset:Number(c.chainId??configuration().chainId)===1952?"TEST-USDT":"USDT0";}
export function assertCardEnvironment(card:Card){
 const cfg=configuration();if(cfg.local)return;
 if(Number(card.chainId??(cfg.testnet?1952:0))!==cfg.chainId||(card.paymentEnvironment!==undefined&&card.paymentEnvironment!==cfg.paymentEnvironment))throw new ApiError(409,"PAYMENT_ENVIRONMENT_MISMATCH","Card belongs to another payment deployment.");
 if(cfg.mainnet&&(!card.settlement||!isSettlementV2(card.settlement)||card.settlement.paymentEnvironment!=="mainnet"||card.reviewerVersion!==4||card.reviewNetwork!=="studionet"||card.paymentEnvironment!=="mainnet"||card.reviewGenesis!==cfg.genLayerGenesis||card.reviewConsensus?.toLowerCase()!==cfg.genLayerConsensus?.toLowerCase()))throw new ApiError(409,"PAYMENT_ENVIRONMENT_MISMATCH","Mainnet cards require explicit payment and Studionet reviewer bindings.");
 if(card.settlement&&isSettlementV2(card.settlement)&&card.settlement.paymentEnvironment!==cfg.paymentEnvironment)throw new ApiError(409,"PAYMENT_ENVIRONMENT_MISMATCH","Card settlement belongs to another payment environment.");
 if(card.settlement&&String(card.token).toLowerCase()!==settlementToken(card.settlement).toLowerCase())throw new ApiError(409,"ASSET_CONFIGURATION_MISMATCH","Card token differs from its committed asset.");
}
export function paymentDestination(c:Card,input:PaymentInput){
 const source=Number(c.chainId??configuration().chainId),destination=input.destinationChainId??source;
 if(!c.settlement){if(destination!==source)throw new ApiError(422,"DESTINATION_NOT_ALLOWED","This legacy card permits only its immutable source chain.");return {chainId:source,token:String(c.token??configuration().token).toLowerCase(),domain:undefined};}
 const s=c.settlement;
 if(isSettlementV2(s)){
  if(source!==SOURCE_CHAIN_IDS[s.paymentEnvironment]||String(c.token).toLowerCase()!==sourceToken(s.paymentEnvironment,s.asset))throw new ApiError(409,"ASSET_CONFIGURATION_MISMATCH","Card source chain/token conflicts with its permission profile.");
  if(!s.destinationChainIds.includes(destination))throw new ApiError(422,"DESTINATION_NOT_ALLOWED","Owner did not approve this destination.");
  if(s.asset==="USDT0"){if(destination!==196)throw new ApiError(422,"DESTINATION_NOT_ALLOWED","USDT0 permits X Layer mainnet only.");return {chainId:196,token:sourceToken("mainnet","USDT0"),domain:37};}
  const route=paymentRoute(s.paymentEnvironment,destination);return {chainId:route.chainId,token:route.token,domain:route.domain};
 }
 if(source!==1952||String(c.token).toLowerCase()!==CCTP_TESTNETS[1952].token.toLowerCase())throw new ApiError(409,"ASSET_CONFIGURATION_MISMATCH","The card token is inconsistent with its committed settlement configuration.");
 if(!s.destinationChainIds.includes(destination as 1952|84532|421614))throw new ApiError(422,"DESTINATION_NOT_ALLOWED","Owner did not approve this destination testnet.");
 const route=CCTP_TESTNETS[destination];if(!route)throw new ApiError(422,"DESTINATION_NOT_ALLOWED","Unsupported destination testnet.");
 return {chainId:route.chainId,token:route.token.toLowerCase(),domain:route.domain};
}
export function canonicalDestination(c:Card,input:PaymentInput):Partial<CanonicalRequest>{const d=paymentDestination(c,input);return c.settlement?{settlementHash:digest(c.settlement),destinationChainId:d.chainId,destinationToken:d.token,destinationDomain:d.domain}:input.destinationChainId!==undefined?{destinationChainId:d.chainId}:{};}
export function isBridge(c:Card,p:{canonical?:CanonicalRequest;input:PaymentInput}){return c.settlement?.asset==="USDC"&&paymentDestination(c,p.canonical??p.input).chainId!==Number(c.chainId??configuration().chainId);}
export function cardContractVersion(c:Card){return c.settlement?.asset==="USDC"?(isSettlementV2(c.settlement)?4:2):1;}
