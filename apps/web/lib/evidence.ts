export class EvidenceFailure extends Error{constructor(public code:string,message:string){super(message)}}

import {lookup} from "node:dns/promises";
import {isIP,type LookupFunction} from "node:net";
import type {LookupAddress} from "node:dns";
import https from "node:https";
import {contentDigest,type Snapshot,type PaymentInput} from "../../../packages/shared";
export function publicIp(ip:string):boolean{
 if(isIP(ip)===4){const[a,b]=ip.split(".").map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&ip.split(".")[2]==="113"))}
 if(isIP(ip)===6){const p=ip.toLowerCase();const prefix=parseInt(p.split(":")[0],16);return prefix>=0x2000&&prefix<0x4000&&!p.startsWith("2001:db8:")&&!p.startsWith("2001:0:")&&!p.startsWith("2002:")&&!p.startsWith("::")&&!p.startsWith("fc")&&!p.startsWith("fd")&&!p.startsWith("fe8")&&!p.startsWith("fe9")&&!p.startsWith("fea")&&!p.startsWith("feb")&&!p.startsWith("ff")}
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
