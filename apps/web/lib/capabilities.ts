import {configuration,publicConfiguration} from "./config";
import {runtimeManifest} from "./deployment-profile";
import {profileRoutes,sourceToken,ISSUER_SOURCES} from "../../../packages/shared/payment-profiles";
/** Candidate issuer entries cannot become advertised spending authority. */
export async function publicDeploymentConfiguration(){
 const base=publicConfiguration(),cfg=configuration();
 if(!cfg.mainnet&&!cfg.verifiedManifest)return {...base,readinessReasons:base.configured?[]:["NOT_CONFIGURED"]};
 try{
  if(!cfg.configured)throw Error("Not configured");
  const manifest=await runtimeManifest(cfg),routes=profileRoutes(manifest.paymentEnvironment);
  return {...base,assets:manifest.enabledAssets.map(asset=>({asset,symbol:asset,chainId:cfg.chainId,decimals:6,token:sourceToken(manifest.paymentEnvironment,asset),available:true,reason:"Release-pinned deployment capability; GenLayer review runs on Studionet testnet.",sources:asset==="USDC"?[ISSUER_SOURCES.usdc,ISSUER_SOURCES.cctp]:[ISSUER_SOURCES.usdt0Mainnet]})),spendingNetworks:manifest.verifiedDestinationChainIds.map(id=>{const r=routes[id];return {chainId:r.chainId,name:r.name,domain:r.domain,token:r.token,explorerUrl:r.explorerUrl}}),readinessReasons:[]};
 }catch{return {...base,configured:false,assets:[],spendingNetworks:[],readinessReasons:["DEPLOYMENT_NOT_VERIFIED"]};}
}
