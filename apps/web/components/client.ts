import {createPublicClient, createWalletClient, custom, defineChain, decodeEventLog, type Address, type Abi} from "viem";
import type {CardView, DraftView, Policy, RequestView} from "@intentguard/shared";
import exportedAbis from "../../../contracts/evm/abi.json";

export type {CardView, DraftView, Policy, RequestView};
export type Config = {mode:"live"|"local"|"testnet";rpcUrl?:string;networkName?:string;paymentSymbol?:string;chainId:number;token:string;factoryAddress:string|null;explorerUrl:string;genLayerExplorerUrl:string;applicationUrl?:string;configured:boolean;activation?:Record<string,unknown>};
export type ActivationDraft = DraftView & {activation?:{factoryAddress:string;config:Record<string,unknown>}};
type Provider = {request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,handler:(...args:unknown[])=>void)=>void;removeListener?:(event:string,handler:(...args:unknown[])=>void)=>void};
declare global {interface Window {ethereum?:Provider}}
export class ProductApiError extends Error{
 constructor(message:string,public status:number,public code:string,public requestId:string|null,public retryable:boolean,public retryAfter:number|null){super(message)}
}
export async function api<T>(path:string, init?:RequestInit):Promise<T>{
 const headers=new Headers(init?.headers);if(!headers.has("Content-Type"))headers.set("Content-Type","application/json");
 const timeout=AbortSignal.timeout(25000),signal=init?.signal?AbortSignal.any([init.signal,timeout]):timeout;
 let response:Response;
 try{response=await fetch("/api/v1"+path,{...init,signal,headers,credentials:"same-origin",cache:"no-store"})}catch(e){if(init?.signal?.aborted)throw e;throw new ProductApiError(signal.aborted?"The service took too long to respond. Retry or refresh to recover an admitted request.":"The service could not be reached. Check your connection and retry.",0,signal.aborted?"REQUEST_TIMEOUT":"NETWORK_ERROR",null,true,null)}
 if(response.status===204&&response.ok)return undefined as T;
 let body:unknown;try{body=await response.json()}catch{throw new ProductApiError("The service returned an unreadable response. Retry or share its request ID with the operator.",response.status,"INVALID_RESPONSE",response.headers.get("X-Request-Id"),true,null)}
 if(!response.ok){const error=(body as {error?:{message?:string;code?:string;requestId?:string;retryable?:boolean}}).error;const code=error?.code??"REQUEST_FAILED",requestId=error?.requestId??response.headers.get("X-Request-Id");const after=response.headers.get("Retry-After");throw new ProductApiError((error?.message||"The request could not be completed.")+" ["+code+"]"+(requestId?" Request ID: "+requestId:""),response.status,code,requestId,error?.retryable??response.status>=500,after!==null&&Number.isFinite(Number(after))?Number(after):null)}
 return body as T;
}
export function parseUnitsExact(v:string):bigint{if(!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(v))throw Error("Use a positive USDT amount with up to six decimal places.");const[a,b=""]=v.split(".");const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,"0"));if(n>(1n<<64n)-1n)throw Error("This amount exceeds the supported limit.");return n}
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
export async function login(address:Address){if(!window.ethereum)throw Error("Wallet unavailable.");const {message}=await api<{message:string}>("/auth/challenge",{method:"POST",body:JSON.stringify({address})});const client=createWalletClient({transport:custom(window.ethereum)});const signature=await client.signMessage({account:address,message});await api("/auth/login",{method:"POST",body:JSON.stringify({address,signature})})}
export async function contractWrite(config:Config,address:string,abi:Abi,functionName:string,args:readonly unknown[],owner:string,onStatus:(status:string)=>void){
 if(!window.ethereum)throw Error("Reconnect your EVM wallet to continue.");const chain=defineChain({id:config.chainId,name:config.networkName||(config.chainId===1952?"X Layer Testnet":config.chainId===196?"X Layer":"Configured network"),nativeCurrency:{name:"OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[config.rpcUrl||(config.chainId===1952?"https://testrpc.xlayer.tech":"https://rpc.xlayer.tech")]}}});
 const current=Number(BigInt(await window.ethereum.request({method:"eth_chainId"}) as string));if(current!==config.chainId){onStatus("Switch to "+chain.name+" in your wallet.");try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x"+config.chainId.toString(16)}]})}catch(e){if((e as {code?:number}).code===4902&&[196,1952].includes(config.chainId)){await window.ethereum.request({method:"wallet_addEthereumChain",params:[{chainId:"0x"+config.chainId.toString(16),chainName:chain.name,nativeCurrency:chain.nativeCurrency,rpcUrls:chain.rpcUrls.default.http,blockExplorerUrls:[config.explorerUrl]}]})}else throw e}}
 const accounts=await window.ethereum.request({method:"eth_accounts"}) as string[];if(accounts[0]?.toLowerCase()!==owner.toLowerCase())throw Error("Select the connected owner account in your wallet.");
 const client=createWalletClient({chain,transport:custom(window.ethereum)});const publicClient=createPublicClient({chain,transport:custom(window.ethereum)});onStatus("Confirm the transaction in your wallet.");const hash=await client.writeContract({address:address as Address,abi,functionName,args,account:owner as Address});onStatus("Transaction submitted. Waiting for confirmation.");const receipt=await publicClient.waitForTransactionReceipt({hash,confirmations:2});if(receipt.status!=="success")throw Error("The transaction reverted. No successful action was recorded.");onStatus("Transaction confirmed.");return receipt;
}

export const factoryAbi=exportedAbis.CardFactory as Abi;
export const cardAbi=exportedAbis.AgentSpendingCard as Abi;
const pendingActivations=new Map<string,{cardAddress:string;transactionHash:string}>();
export async function activateCard(config:Config,draft:ActivationDraft,owner:string,onStatus:(s:string)=>void){
 if(!draft.activation||draft.state!=="FINALIZED"||draft.status!=="PROPOSED")throw Error("A finalized proposal with an activation configuration is required.");
 const recoveryKey="intentguard-activation:"+owner.toLowerCase()+":"+draft.id;
 let pending=pendingActivations.get(recoveryKey);if(!pending){try{const saved=JSON.parse(localStorage.getItem(recoveryKey)||"null") as {cardAddress?:string;transactionHash?:string}|null;if(saved&&/^0x[0-9a-fA-F]{40}$/.test(saved.cardAddress||"")&&/^0x[0-9a-fA-F]{64}$/.test(saved.transactionHash||""))pending={cardAddress:saved.cardAddress!,transactionHash:saved.transactionHash!}}catch{}}
 const clearRecovery=()=>{pendingActivations.delete(recoveryKey);try{localStorage.removeItem(recoveryKey)}catch{}};
 if(pending){onStatus("Retrying server verification of the confirmed card deployment.");await api("/owner/cards",{method:"POST",body:JSON.stringify({draftId:draft.id,cardAddress:pending.cardAddress,activationTx:pending.transactionHash})});clearRecovery();return pending.cardAddress}
 const values:Record<string,unknown>={};for(const component of exportedAbis.configTuple.components){const value=draft.activation.config[component.name];if(value===undefined)throw Error("Activation configuration is missing "+component.name);values[component.name]=/^uint/.test(component.type)?BigInt(String(value)):value}
 if(String(values.owner).toLowerCase()!==owner.toLowerCase())throw Error("The finalized configuration belongs to another owner.");
 const receipt=await contractWrite(config,draft.activation.factoryAddress,factoryAbi,"createCard",[values],owner,onStatus);
 let cardAddress:string|undefined;for(const log of receipt.logs){if(log.address.toLowerCase()!==draft.activation.factoryAddress.toLowerCase())continue;try{const event=decodeEventLog({abi:factoryAbi,data:log.data,topics:log.topics});if(event.eventName==="CardCreated"){const args=event.args as unknown as {owner:string;card:string};if(args.owner.toLowerCase()===owner.toLowerCase())cardAddress=args.card}}catch{}}
 if(!cardAddress)throw Error("The wallet transaction confirmed but no CardCreated event was found. Keep the transaction hash for recovery: "+receipt.transactionHash);
 pendingActivations.set(recoveryKey,{cardAddress,transactionHash:receipt.transactionHash});try{localStorage.setItem(recoveryKey,JSON.stringify({draftId:draft.id,cardAddress,transactionHash:receipt.transactionHash}))}catch{}onStatus("Card deployed. Verifying the finalized permission with the server.");await api("/owner/cards",{method:"POST",body:JSON.stringify({draftId:draft.id,cardAddress,activationTx:receipt.transactionHash})});clearRecovery();return cardAddress;
}
