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
type EvidenceTransport={lookup:typeof lookup;request:typeof https.request};
export function createEvidenceFetcher(transport:EvidenceTransport,deadlineMs=12000){
 return async function fetchEvidence(raw:string):Promise<string>{
  const url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))throw Error("Only public HTTPS evidence is supported");
  const host=url.hostname.replace(/^\[|\]$/g,"");
  return new Promise((resolve,reject)=>{
   let settled=false,request:ReturnType<typeof https.request>|undefined;
   const finish=(error?:Error,content?:string)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){request?.destroy(error);reject(error)}else resolve(content!);};
   // Absolute deadline starts before DNS and cannot be extended by trickling bytes.
   const timer=setTimeout(()=>finish(Error("Evidence fetch timed out")),deadlineMs);
   transport.lookup(host,{all:true}).then(addresses=>{
    if(settled)return;
    if(!addresses.length||addresses.some(a=>!publicIp(a.address))){finish(Error("Evidence source resolves to a private/reserved network"));return}
    request=transport.request(url,{method:"GET",timeout:deadlineMs,lookup:pinnedLookup(addresses[0]),headers:{"Accept-Encoding":"identity"}},res=>{
     if(res.statusCode!==200){finish(Error("Evidence must return HTTP 200 without redirects"));return}
     const type=String(res.headers["content-type"]??"").toLowerCase(),encoding=String(res.headers["content-encoding"]??"identity").toLowerCase();
     if(!type.includes("json")&&!type.startsWith("text/")){finish(Error("Evidence must be text or JSON"));return}
     if(encoding!=="identity"){finish(Error("Evidence must use identity content encoding"));return}
     const length=res.headers["content-length"];
     if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>65536)){finish(Error("Evidence exceeds 64 KiB"));return}
     const chunks:Buffer[]=[];let size=0;
     res.on("data",(chunk:Buffer)=>{if(settled)return;size+=chunk.length;if(size>65536){finish(Error("Evidence exceeds 64 KiB"));return}chunks.push(chunk)});
     res.on("end",()=>{try{finish(undefined,new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)))}catch{finish(Error("Evidence must be valid UTF-8"))}});
     res.on("aborted",()=>finish(Error("Evidence response was interrupted")));res.on("error",finish);
    });
    request.on("timeout",()=>finish(Error("Evidence fetch timed out")));request.on("error",finish);request.end();
   }).catch(error=>finish(error instanceof Error?error:Error("Evidence lookup failed")));
  });
 };
}
export const safeFetch=createEvidenceFetcher({lookup,request:https.request});
export async function capture(input:PaymentInput,fetcher=safeFetch):Promise<Snapshot[]>{const snapshots:Snapshot[]=[];let total=0;for(const item of input.evidence){const content=await fetcher(item.url);if(!content||Buffer.byteLength(content)>65536)throw Error("Evidence source exceeds 64 KiB or is empty");if(snapshots.some(s=>s.url===item.url))throw Error("Evidence URLs must be unique");total+=Buffer.byteLength(content);if(total>131072)throw Error("Evidence bundle exceeds 128 KiB");const hash=contentDigest(content);if(item.sha256&&hash.toLowerCase()!==("0x"+item.sha256.replace(/^0x/,"")).toLowerCase())throw new EvidenceFailure("EVIDENCE_HASH_MISMATCH","Declared evidence SHA-256 does not match the fetched bytes.");snapshots.push({url:item.url,sha256:hash,content,fetchedAt:Math.floor(Date.now()/1000)})}return snapshots}
