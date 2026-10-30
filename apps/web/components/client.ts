import {createPublicClient, createWalletClient, custom, defineChain, decodeEventLog, type Address, type Abi} from "viem";
import type {CardView, DraftView, Policy, RequestView, Settlement} from "@intentguard/shared";
import exportedAbis from "../../../contracts/evm/abi.json";

export type {CardView, DraftView, Policy, RequestView, Settlement};
export type Config = {mode:"local"|"testnet"|"mainnet";paymentEnvironment?:"local"|"testnet"|"mainnet";reviewEnvironment?:"testnet";reviewNetwork?:"studionet";reviewChainId?:61999;releaseId?:string|null;sourceCommit?:string|null;apiOrigin?:string;frontendOrigin?:string;ownerSessionTransport?:"cookie"|"owner-bearer";settlementVersion?:1|2;readinessReasons?:string[];rpcUrl?:string;networkName?:string;paymentSymbol?:string;chainId:number;token:string;factoryAddress:string|null;explorerUrl:string;genLayerExplorerUrl:string;applicationUrl?:string;configured:boolean;activation?:Record<string,unknown>;assets?:{asset:string;symbol:string;chainId:number;decimals:number;token:string|null;available:boolean;reason:string;sources:string[]}[];spendingNetworks?:{chainId:number;name:string;domain:number;token:string;explorerUrl:string}[];cctpFactoryAddress?:string|null};
export type ActivationDraft = DraftView & {input?:{description:string;guidance?:unknown};settlement?:Settlement;activation?:{factoryAddress:string;config:Record<string,unknown>;kind?:"CCTP_V2"|"CCTP_V4"|"USDT0_LOCAL";destinationDomains?:number[];settlement?:Settlement}};
type Provider = {request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,handler:(...args:unknown[])=>void)=>void;removeListener?:(event:string,handler:(...args:unknown[])=>void)=>void};
declare global {interface Window {ethereum?:Provider}}
export class ProductApiError extends Error{
 constructor(message:string,public status:number,public code:string,public requestId:string|null,public retryable:boolean,public retryAfter:number|null){super(message)}
}
const compiledApiOrigin=process.env.NEXT_PUBLIC_INTENTGUARD_API_ORIGIN||"";
const compiledEnvironment=process.env.NEXT_PUBLIC_INTENTGUARD_PAYMENT_ENV||"";
const compiledSourceCommit=process.env.NEXT_PUBLIC_INTENTGUARD_SOURCE_COMMIT||"";
export const staticFrontend=process.env.NEXT_PUBLIC_INTENTGUARD_STATIC_EXPORT==="1";
let verifiedConfig:Config|null=null,configTask:Promise<Config>|null=null,ownerToken:{value:string;expiresAt:number}|null=null,sessionEpoch=0;
export function clearOwnerSession(){ownerToken=null;sessionEpoch++;}
export function logout(){const token=ownerToken?.value;clearOwnerSession();return api("/auth/logout",{method:"POST",...(token?{headers:{Authorization:"Owner "+token}}:{})});}
export function transactionHref(id:string){return staticFrontend?"/transaction?id="+encodeURIComponent(id):"/explorer/transactions/"+encodeURIComponent(id);}
export function apiOrigin(){if(typeof window==="undefined")throw Error("Browser API access is unavailable during rendering.");if(!compiledApiOrigin)return window.location.origin;const url=new URL(compiledApiOrigin);if(url.origin!==compiledApiOrigin||url.protocol!=="https:")throw Error("The frontend API origin must be a pinned HTTPS origin.");return url.origin;}
function validateConfig(config:Config){
 try{
 const target=apiOrigin(),cross=target!==window.location.origin,expected=compiledEnvironment;
 if(!["local","testnet","mainnet"].includes(config.mode)||config.paymentEnvironment!==config.mode)throw Error("The service returned an inconsistent payment environment.");
 if((expected&&config.mode!==expected)||(config.mode==="testnet"&&config.chainId!==1952)||(config.mode==="mainnet"&&config.chainId!==196))throw Error("This frontend and API belong to different payment deployments.");
 if(config.reviewEnvironment!=="testnet"||config.reviewNetwork!=="studionet"||config.reviewChainId!==61999)throw Error("This deployment must use the disclosed Studionet testnet review.");
 if(config.apiOrigin&&config.apiOrigin!==target)throw Error("The service API origin does not match the frontend pin.");
 if(cross&&(config.apiOrigin!==target||config.frontendOrigin!==window.location.origin||config.ownerSessionTransport!=="owner-bearer"||!expected))throw Error("The separate frontend/API authority is not configured.");
 if(config.mode==="mainnet"&&(!expected||!config.releaseId||!/^[a-f0-9]{40}$/.test(config.sourceCommit||"")||(compiledSourceCommit&&config.sourceCommit!==compiledSourceCommit)))throw Error("The mainnet release identity does not match this frontend.");
 if(verifiedConfig&&(verifiedConfig.mode!==config.mode||verifiedConfig.chainId!==config.chainId||verifiedConfig.sourceCommit!==config.sourceCommit))clearOwnerSession();
 verifiedConfig=config;return config;
 }catch(error){clearOwnerSession();verifiedConfig=null;throw error;}
}
async function checkedConfig(){if(verifiedConfig)return verifiedConfig;if(!configTask)configTask=api<Config>("/config").finally(()=>{configTask=null;});return configTask;}
export async function apiResponse(path:string,init?:RequestInit):Promise<Response>{
 if(!path.startsWith("/")||path.startsWith("//")||path.includes("\\"))throw Error("Invalid API path.");
 const publicRequest=path==="/config"||path==="/health"||path.startsWith("/explorer/"),target=apiOrigin(),cross=target!==window.location.origin;
 const headers=new Headers(init?.headers);if(!headers.has("Content-Type"))headers.set("Content-Type","application/json");
 let config:Config|null=null;
 if(path!=="/config"&&path!=="/health")config=await checkedConfig();
 if(!publicRequest&&!config?.configured){clearOwnerSession();throw new ProductApiError("This deployment is not ready for owner actions.",503,"DEPLOYMENT_NOT_VERIFIED",null,true,null);}
 const expected=compiledEnvironment||config?.mode||verifiedConfig?.mode;if(expected)headers.set("X-IntentGuard-Environment",expected);
 if(ownerToken&&ownerToken.expiresAt<=Date.now())clearOwnerSession();
 if(!publicRequest&&cross&&ownerToken&&!headers.has("Authorization"))headers.set("Authorization","Owner "+ownerToken.value);
 if(publicRequest&&headers.has("Authorization"))throw Error("Public requests must not contain credentials.");
 const timeout=AbortSignal.timeout(25000),signal=init?.signal?AbortSignal.any([init.signal,timeout]):timeout;
 try{return await fetch(target+"/api/v1"+path,{...init,signal,headers,credentials:cross||publicRequest?"omit":"same-origin",cache:"no-store"});}
 catch(e){if(init?.signal?.aborted)throw e;throw new ProductApiError(signal.aborted?"The service took too long to respond. Retry or refresh to recover an admitted request.":"The service could not be reached. Check your connection and retry.",0,signal.aborted?"REQUEST_TIMEOUT":"NETWORK_ERROR",null,true,null);}
}
export async function api<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await apiResponse(path,init);
 if(response.status===204&&response.ok)return undefined as T;
 let body:unknown;try{body=await response.json();}catch{throw new ProductApiError("The service returned an unreadable response. Retry or share its request ID with the operator.",response.status,"INVALID_RESPONSE",response.headers.get("X-Request-Id"),true,null);}
 if(!response.ok){if(response.status===401)clearOwnerSession();const error=(body as {error?:{message?:string;code?:string;requestId?:string;retryable?:boolean}}).error;const code=error?.code??"REQUEST_FAILED",requestId=error?.requestId??response.headers.get("X-Request-Id"),after=response.headers.get("Retry-After");throw new ProductApiError((error?.message||"The request could not be completed.")+" ["+code+"]"+(requestId?" Request ID: "+requestId:""),response.status,code,requestId,error?.retryable??response.status>=500,after!==null&&Number.isFinite(Number(after))?Number(after):null);}
 return (path==="/config"?validateConfig(body as Config):body) as T;
}
export function parseUnitsExact(v:string):bigint{if(!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(v))throw Error("Use an exact token amount with up to six decimal places.");const[a,b=""]=v.split(".");const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,"0"));if(n>(1n<<64n)-1n)throw Error("This amount exceeds the supported limit.");return n}
export function amount(v:string|undefined, decimals=2):string{if(v===undefined||v===null||!/^\d+(\.\d{1,6})?$/.test(v))return "Unavailable";const [whole,fraction=""]=v.split(".");const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,",");return grouped+(decimals?"."+fraction.padEnd(decimals,"0").slice(0,Math.max(decimals,fraction.replace(/0+$/,"").length)):"")}
export function difference(a:string,b:string,c="0"):string{try{const v=parseUnitsExact(a)-parseUnitsExact(b)-parseUnitsExact(c);const n=v<0n?0n:v;const f=(n%1000000n).toString().padStart(6,"0").replace(/0+$/,"");return (n/1000000n).toString()+(f?"."+f:"")}catch{return "Unavailable"}}
export const short=(v:string,size=6)=>v.length>size*2+3?v.slice(0,size)+"…"+v.slice(-4):v;
export const human=(s:string)=>s.toLowerCase().replace(/_/g," ").replace(/^./,c=>c.toUpperCase());
export function errorMessage(e:unknown){const message=e instanceof Error?e.message:"Something went wrong. Please retry.";if((e as {code?:number;cause?:{code?:number}})?.code===4001||(e as {cause?:{code?:number}})?.cause?.code===4001||/user rejected|user denied|wallet request declined|UserRejectedRequestError/i.test(message))return "Wallet request declined. Your form is preserved; retry when you are ready.";return message.split("\n")[0].slice(0,500)}
export function date(v:number,full=false){return new Intl.DateTimeFormat("en",{month:"short",day:"numeric",...(full?{year:"numeric" as const,hour:"2-digit" as const,minute:"2-digit" as const}:{hour:"2-digit" as const,minute:"2-digit" as const})}).format(new Date(v<1e12?v*1000:v))}
export function txUrl(base:string,hash?:string,protocol:"evm"|"genlayer"="evm"){return hash&&base?base.replace(/\/$/,"")+(protocol==="genlayer"?"/transactions/":"/tx/")+hash:null}
export const erc20Abi=[{type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]}] as const;
export const ownerAbi=[{type:"function",name:"setEnabled",stateMutability:"nonpayable",inputs:[{name:"enabled",type:"bool"}],outputs:[]},{type:"function",name:"revoke",stateMutability:"nonpayable",inputs:[],outputs:[]},{type:"function",name:"withdraw",stateMutability:"nonpayable",inputs:[{name:"amount",type:"uint64"}],outputs:[]},{type:"function",name:"cancel",stateMutability:"nonpayable",inputs:[{name:"requestId",type:"bytes32"}],outputs:[]}] as const;
export async function walletAddress(){if(!window.ethereum)throw Error("Install an EVM wallet to connect, then reload this page.");const accounts=await window.ethereum.request({method:"eth_requestAccounts"}) as string[];if(!accounts[0])throw Error("No wallet account is available.");return accounts[0] as Address}
export async function login(address:Address){
 if(!window.ethereum)throw Error("Wallet unavailable.");
 const epoch=sessionEpoch,config=await checkedConfig();
 const {message}=await api<{message:string}>("/auth/challenge",{method:"POST",body:JSON.stringify({address})});
 const wallet=createWalletClient({transport:custom(window.ethereum)}),signature=await wallet.signMessage({account:address,message});
 if(epoch!==sessionEpoch)throw Error("The owner account changed during sign-in.");
 const selected=await window.ethereum.request({method:"eth_accounts"}) as string[];
 if(selected[0]?.toLowerCase()!==address.toLowerCase())throw Error("The owner account changed during sign-in.");
 const result=await api<{address:string;ownerSession?:string;expiresAt?:number}>("/auth/login",{method:"POST",body:JSON.stringify({address,signature})});
 if(epoch!==sessionEpoch)throw Error("The owner account changed during sign-in.");
 if(result.address.toLowerCase()!==address.toLowerCase())throw Error("The service signed in another owner.");
 if(config.ownerSessionTransport==="owner-bearer"){
  if(!result.ownerSession||!Number.isSafeInteger(result.expiresAt)||result.expiresAt!<=Date.now()||result.expiresAt!>Date.now()+10*60*1000)throw Error("The service returned an invalid owner session.");
  ownerToken={value:result.ownerSession,expiresAt:result.expiresAt!};
 }
}
export async function contractWrite(config:Config,address:string,abi:Abi,functionName:string,args:readonly unknown[],owner:string,onStatus:(status:string)=>void){
 if(!window.ethereum)throw Error("Reconnect your EVM wallet to continue.");const checked=validateConfig(config);if(!checked.configured)throw Error("This deployment is not ready for wallet transactions.");const chain=defineChain({id:config.chainId,name:config.networkName||(config.chainId===1952?"X Layer Testnet":config.chainId===196?"X Layer":"Configured network"),nativeCurrency:{name:"OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[config.rpcUrl||(config.chainId===1952?"https://testrpc.xlayer.tech":"https://rpc.xlayer.tech")]}}});
 const current=Number(BigInt(await window.ethereum.request({method:"eth_chainId"}) as string));if(current!==config.chainId){onStatus("Switch to "+chain.name+" in your wallet.");try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x"+config.chainId.toString(16)}]})}catch(e){if((e as {code?:number}).code===4902&&[196,1952].includes(config.chainId)){await window.ethereum.request({method:"wallet_addEthereumChain",params:[{chainId:"0x"+config.chainId.toString(16),chainName:chain.name,nativeCurrency:chain.nativeCurrency,rpcUrls:chain.rpcUrls.default.http,blockExplorerUrls:[config.explorerUrl]}]})}else throw e}}
 const accounts=await window.ethereum.request({method:"eth_accounts"}) as string[];if(accounts[0]?.toLowerCase()!==owner.toLowerCase())throw Error("Select the connected owner account in your wallet.");
 const client=createWalletClient({chain,transport:custom(window.ethereum)});const publicClient=createPublicClient({chain,transport:custom(window.ethereum)});onStatus("Confirm the transaction in your wallet.");const hash=await client.writeContract({address:address as Address,abi,functionName,args,account:owner as Address});onStatus("Transaction submitted. Waiting for confirmation.");const receipt=await publicClient.waitForTransactionReceipt({hash,confirmations:2});if(receipt.status!=="success")throw Error("The transaction reverted. No successful action was recorded.");onStatus("Transaction confirmed.");return receipt;
}

export const factoryAbi=exportedAbis.CardFactory as Abi;
export const cctpFactoryAbi=exportedAbis.CctpCardFactory as Abi;
export function paymentSymbol(record?:{paymentSymbol?:string;settlement?:Settlement;token?:string;chainId?:number}|null,config?:Config|null){if(record?.paymentSymbol)return record.paymentSymbol;if(record?.settlement)return record.settlement.asset;const issued=config?.assets?.find(a=>a.available&&a.token&&a.chainId===record?.chainId&&a.token.toLowerCase()===record?.token?.toLowerCase());return issued?.symbol||config?.paymentSymbol||"Token"}
export function networkName(chainId:number|undefined,config?:Config|null){return config?.spendingNetworks?.find(n=>n.chainId===chainId)?.name||(chainId===1952?"X Layer Testnet":chainId===84532?"Base Sepolia":chainId===421614?"Arbitrum Sepolia":config?.networkName||"Configured network")}
export function explorerForChain(chainId:number|undefined,config?:Config|null){return config?.spendingNetworks?.find(n=>n.chainId===chainId)?.explorerUrl||(chainId===84532?"https://sepolia.basescan.org":chainId===421614?"https://sepolia.arbiscan.io":config?.explorerUrl||"")}
export function paymentExplorer(request:{bridge?:RequestView["bridge"];destinationChainId?:number},config?:Config|null){return explorerForChain(request.bridge?.destinationChainId??request.destinationChainId,config)}
export const cardAbi=exportedAbis.AgentSpendingCard as Abi;
const pendingActivations=new Map<string,{cardAddress:string;transactionHash:string}>();
export async function activateCard(config:Config,draft:ActivationDraft,owner:string,onStatus:(s:string)=>void){
 if(!draft.activation||draft.state!=="FINALIZED"||draft.status!=="PROPOSED")throw Error("A finalized proposal with an activation configuration is required.");
 const recoveryKey="intentguard-activation:"+apiOrigin()+":"+config.mode+":"+config.chainId+":"+owner.toLowerCase()+":"+draft.id;
 let pending=pendingActivations.get(recoveryKey);if(!pending){try{const saved=JSON.parse(localStorage.getItem(recoveryKey)||"null") as {cardAddress?:string;transactionHash?:string}|null;if(saved&&/^0x[0-9a-fA-F]{40}$/.test(saved.cardAddress||"")&&/^0x[0-9a-fA-F]{64}$/.test(saved.transactionHash||""))pending={cardAddress:saved.cardAddress!,transactionHash:saved.transactionHash!}}catch{}}
 const clearRecovery=()=>{pendingActivations.delete(recoveryKey);try{localStorage.removeItem(recoveryKey)}catch{}};
 if(pending){onStatus("Retrying server verification of the confirmed card deployment.");await api("/owner/cards",{method:"POST",body:JSON.stringify({draftId:draft.id,cardAddress:pending.cardAddress,activationTx:pending.transactionHash})});clearRecovery();return pending.cardAddress}
 const values:Record<string,unknown>={};for(const component of exportedAbis.configTuple.components){const value=draft.activation.config[component.name];if(value===undefined)throw Error("Activation configuration is missing "+component.name);values[component.name]=/^uint/.test(component.type)?BigInt(String(value)):value}
 if(String(values.owner).toLowerCase()!==owner.toLowerCase())throw Error("The finalized configuration belongs to another owner.");
 const bridge=draft.activation.kind==="CCTP_V2"||draft.activation.kind==="CCTP_V4";
 const settlement=draft.settlement,versioned=settlement&&"version" in settlement;
 if(versioned&&(settlement.paymentEnvironment!==config.mode||config.settlementVersion!==2))throw Error("The proposal settlement belongs to another deployment or factory version.");
 const approvedAsset=versioned?config.assets?.find(a=>a.available&&a.asset===settlement.asset&&a.chainId===config.chainId):null;
 if(versioned&&(!approvedAsset?.token||String(values.token).toLowerCase()!==approvedAsset.token.toLowerCase()))throw Error("The proposal token is not a verified deployment asset.");
 const expectedFactory=bridge?config.cctpFactoryAddress:config.factoryAddress;
 if(!expectedFactory||draft.activation.factoryAddress.toLowerCase()!==expectedFactory.toLowerCase())throw Error("The activation factory is not this deployment's verified factory.");
 const abi=draft.activation.kind==="CCTP_V4"?exportedAbis.CctpCardFactoryV4 as Abi:draft.activation.kind==="USDT0_LOCAL"?exportedAbis.MainnetUsdt0CardFactory as Abi:bridge?cctpFactoryAbi:factoryAbi;
 if(bridge){
  const ids=settlement?.destinationChainIds,domains=draft.activation.destinationDomains;
  if(!ids?.length||!domains?.length||ids.length!==domains.length||new Set(domains).size!==domains.length)throw Error("Activation is missing exact owner-approved destination domains.");
  const expected=ids.map(id=>config.spendingNetworks?.find(n=>n.chainId===id)?.domain);
  if(expected.some(d=>d===undefined)||JSON.stringify([...domains].sort((a,b)=>a-b))!==JSON.stringify(expected.sort((a,b)=>Number(a)-Number(b))))throw Error("Activation destination domains are not release-verified.");
 }
 if(draft.activation.kind==="USDT0_LOCAL"&&(!versioned||settlement.asset!=="USDT0"||config.chainId!==196||settlement.destinationChainIds.length!==1||settlement.destinationChainIds[0]!==196))throw Error("USDT0 supports X Layer mainnet settlement only.");
 const receipt=await contractWrite(config,draft.activation.factoryAddress,abi,"createCard",bridge?[values,draft.activation.destinationDomains!]:[values],owner,onStatus);
 let cardAddress:string|undefined;for(const log of receipt.logs){if(log.address.toLowerCase()!==draft.activation.factoryAddress.toLowerCase())continue;try{const event=decodeEventLog({abi,data:log.data,topics:log.topics});if(event.eventName==="CardCreated"){const args=event.args as unknown as {owner:string;card:string};if(args.owner.toLowerCase()===owner.toLowerCase())cardAddress=args.card}}catch{}}
 if(!cardAddress)throw Error("The wallet transaction confirmed but no CardCreated event was found. Keep the transaction hash for recovery: "+receipt.transactionHash);
 pendingActivations.set(recoveryKey,{cardAddress,transactionHash:receipt.transactionHash});try{localStorage.setItem(recoveryKey,JSON.stringify({draftId:draft.id,cardAddress,transactionHash:receipt.transactionHash}))}catch{}onStatus("Card deployed. Verifying the finalized permission with the server.");await api("/owner/cards",{method:"POST",body:JSON.stringify({draftId:draft.id,cardAddress,activationTx:receipt.transactionHash})});clearRecovery();return cardAddress;
}

export async function browserDigest(value:unknown){
 function canonical(value:unknown):string{if(value===null||typeof value!=="object"){const encoded=JSON.stringify(value);if(encoded===undefined)throw Error("Proof is not canonical JSON.");return encoded;}if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";const object=value as Record<string,unknown>;return "{"+Object.keys(object).sort().map(key=>JSON.stringify(key)+":"+canonical(object[key])).join(",")+"}";}
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(value)));return "0x"+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
