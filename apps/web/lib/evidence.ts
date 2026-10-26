export class EvidenceFailure extends Error{constructor(public code:string,message:string){super(message)}}

import {lookup} from "node:dns/promises";
import {isIP,type LookupFunction} from "node:net";
import type {LookupAddress} from "node:dns";
import https from "node:https";
import {contentDigest,type Snapshot,type PaymentInput} from "../../../packages/shared";
export function publicIp(ip:string):boolean{
 if(isIP(ip)===4){const[a,b,c]=ip.split(".").map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113))}
 if(isIP(ip)===6){
  // Compare parsed network bits, never a textual spelling of a prefix.
  // IPv4 embeddings and zone IDs are excluded from evidence transport.
  if(ip.includes(".")||ip.includes("%"))return false;
  const halves=ip.toLowerCase().split("::"),left=halves[0]?halves[0].split(":").map(v=>parseInt(v,16)):[],right=halves[1]?halves[1].split(":").map(v=>parseInt(v,16)):[];
  const words=halves.length===2?[...left,...Array(8-left.length-right.length).fill(0),...right]:left;
  if(words.length!==8)return false;
  const [a,b]=words;
  // Global unicast only, excluding special-purpose, transition and documentation ranges.
  return a>=0x2000&&a<0x4000&&!(a===0x2001&&(b<0x0200||b===0x0db8))&&a!==0x2002&&!(a===0x3fff&&b<0x1000);
 }
 return false;
}
// Node's dual-stack connector requests an address array; keep both lookup modes
// pinned to the same prevalidated address rather than resolving DNS again.
export function pinnedLookup(chosen:LookupAddress):LookupFunction{
 return (_host,options,callback)=>{
  if(options.all)callback(null,[{address:chosen.address,family:chosen.family}]);
  else callback(null,chosen.address,chosen.family);
 };
}
export async function safeFetch(raw:string):Promise<string>{
 const url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))throw Error("Only public HTTPS evidence is supported");
 const host=url.hostname.replace(/^\[|\]$/g,"");const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>!publicIp(a.address)))throw Error("Evidence source resolves to a private/reserved network");
 const chosen=addresses[0];return new Promise((resolve,reject)=>{const request=https.request(url,{method:"GET",timeout:12000,lookup:pinnedLookup(chosen)},res=>{
 if(res.statusCode!==200){res.resume();reject(Error("Evidence must return HTTP 200 without redirects"));return}
 const type=String(res.headers["content-type"]??"").toLowerCase();if(!type.includes("json")&&!type.startsWith("text/")){res.resume();reject(Error("Evidence must be text or JSON"));return}
 const chunks:Buffer[]=[];let size=0;res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>65536){request.destroy(Error("Evidence exceeds 64 KiB"));return}chunks.push(chunk)});res.on("end",()=>{try{resolve(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)))}catch{reject(Error("Evidence must be valid UTF-8"))}});res.on("error",reject)});
 request.on("timeout",()=>request.destroy(Error("Evidence fetch timed out")));request.on("error",reject);request.end();
 });
}
export async function capture(input:PaymentInput,fetcher=safeFetch):Promise<Snapshot[]>{const snapshots:Snapshot[]=[];let total=0;for(const item of input.evidence){const content=await fetcher(item.url);if(!content||Buffer.byteLength(content)>65536)throw Error("Evidence source exceeds 64 KiB or is empty");if(snapshots.some(s=>s.url===item.url))throw Error("Evidence URLs must be unique");total+=Buffer.byteLength(content);if(total>131072)throw Error("Evidence bundle exceeds 128 KiB");const hash=contentDigest(content);if(item.sha256&&hash.toLowerCase()!==("0x"+item.sha256.replace(/^0x/,"")).toLowerCase())throw new EvidenceFailure("EVIDENCE_HASH_MISMATCH","Declared evidence SHA-256 does not match the fetched bytes.");snapshots.push({url:item.url,sha256:hash,content,fetchedAt:Math.floor(Date.now()/1000)})}return snapshots}
