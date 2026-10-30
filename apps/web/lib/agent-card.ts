import {configuration} from "./config";
import type {Card} from "./models";
import type {Store} from "./store";
import {cardChipMarkup,cardMaterialMarkup} from "./agent-card-art";
import {cardFontLicense,cardFontStyles} from "./agent-card-fonts";
export async function agentUsage(store:Store,card:Card){
 const {counts,fundsMoved}=await store.usage(card._id),count=(s:string)=>counts[s]??0;
 return {requestCount:Object.values(counts).reduce((a,b)=>a+b,0),paidCount:count("PAID"),blockedCount:count("BLOCKED"),rejectedCount:count("REJECTED"),needsEvidenceCount:count("NEEDS_EVIDENCE"),cancelledCount:count("CANCELLED"),activeCount:["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","RETRYING","BRIDGING","AWAITING_ATTESTATION","MINTING"].reduce((n,s)=>n+count(s),0),fundsMoved,token:String(card.token??configuration().token),chainId:Number(card.chainId??configuration().chainId),asOf:Date.now()};
}
export type AgentUsage=Awaited<ReturnType<typeof agentUsage>>;
const xml=(v:unknown)=>String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
const short=(value:string)=>value.length>22?value.slice(0,10)+"…"+value.slice(-8):value;
const widthUnits=(value:string)=>Array.from(value).reduce((width,char)=>width+(/\s/.test(char)?.3:/[ilI1.,'!|]/.test(char)?.28:/[MW@]/.test(char)?.85:/[^\u0020-\u024f]/.test(char)?1:.56),0);
/** Bound visible prose without slicing a Unicode code point. Full identity remains in title/desc. */
function proseLines(value:string,maxUnits:number,maxLines:number){
 const remaining=Array.from(value.replace(/\s+/g," ").trim()),lines:string[]=[];
 while(remaining.length&&lines.length<maxLines){
  let size=0,length=0;
  for(const char of remaining){const next=widthUnits(char);if(length&&size+next>maxUnits)break;size+=next;length++}
  if(length<remaining.length){const space=remaining.slice(0,length).lastIndexOf(" ");if(space>length*.5)length=space}
  const line=remaining.splice(0,Math.max(1,length)).join("").trim();
  while(remaining[0]===" ")remaining.shift();
  lines.push(line);
 }
 if(remaining.length&&lines.length)lines[lines.length-1]=lines[lines.length-1].replace(/.$/u,"…");
 return lines;
}
export function cardSvg(agent:{id:string;name:string;mission:string;address:string;policyHash:string;status:string},usage:AgentUsage,symbol:string){
 const nameSize=widthUnits(agent.name)<=20?76:widthUnits(agent.name)<=29?64:52;
 const names=proseLines(agent.name,790/nameSize,2),mission=proseLines(agent.mission,790/22,1)[0]??"";
 const nameY=names.length===1?246:224,missionY=names.length===1?286:330;
 const fundsSize=Math.max(24,Math.min(58,Math.floor(660/(Array.from(usage.fundsMoved).length*.6))));
 const fundsChars=Math.floor(660/(fundsSize*.6)),funds=Array.from(usage.fundsMoved),fundsLines:string[]=[];
 while(funds.length)fundsLines.push(funds.splice(0,fundsChars).join(""));
 const environment=usage.chainId===1952?"TESTNET":usage.chainId===196?"MAINNET":"LOCAL";
 const disclosure=usage.chainId===1952?"TESTNET · NO MONETARY VALUE":usage.chainId===196?"MAINNET PAYMENTS · STUDIONET TESTNET REVIEW":"LOCAL TEST PAYMENTS · NO MONETARY VALUE";
 const provenance=new URL(configuration().frontendOrigin).host,snapshot=new Date(usage.asOf).toISOString();
 let seed=2166136261;for(const char of agent.id)seed=Math.imul(seed^char.charCodeAt(0),16777619);
 const eyeOffset=(Math.abs(seed)%3);
 const statusColor=["ACTIVE","PAID","APPROVED"].includes(agent.status)?"#b5d7ae":["REVOKED","REJECTED","BLOCKED","FAILED"].includes(agent.status)?"#f4a8a3":["PAUSED","PENDING"].includes(agent.status)?"#eed09a":"#c7d0c9";
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-labelledby="title desc">
<title id="title">${xml(agent.name)} · IntentGuard agent card</title><desc id="desc">${xml(agent.mission)}. Snapshot of actual admitted requests: ${usage.requestCount}; settled funds moved: ${xml(usage.fundsMoved)} ${xml(symbol)} on X Layer ${usage.chainId}. ${xml(disclosure)}. Agent vault ${xml(agent.address)}. Policy commitment ${xml(agent.policyHash)}. Status ${xml(agent.status)}. Snapshot ${xml(snapshot)}. No API credentials are included.</desc>
<metadata>${xml(cardFontLicense)}</metadata>
<style>${cardFontStyles}</style>
${cardMaterialMarkup("export")}
<g color="#edf2ec" transform="translate(62 53) scale(1.4)"><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/><path d="M5 20h30" stroke="currentColor" stroke-width="3"/><path d="M20 8v24" stroke="currentColor" stroke-width="2" stroke-dasharray="3 5"/></g>
<g fill="#edf2ec" font-family="'Card Body', 'IBM Plex Sans', sans-serif">
<text x="128" y="91" font-size="32" font-family="'Card Display', 'IBM Plex Sans Condensed', sans-serif" font-weight="600">IntentGuard</text>
<g font-family="'Card Mono', 'IBM Plex Mono', monospace" fill="#c7d0c9"><text x="1136" y="77" text-anchor="end" font-size="18" letter-spacing="3">AGENT CARD</text><text x="1136" y="108" text-anchor="end" font-size="15" letter-spacing="1">X LAYER ${usage.chainId} · ${environment}</text></g>
<g transform="translate(64 178) scale(1.5)">${cardChipMarkup("export-chip")}</g>
<text x="180" y="169" font-size="16" font-family="'Card Mono', 'IBM Plex Mono', monospace" fill="#c7d0c9" letter-spacing="2">ISSUED TO</text>
${names.map((line,index)=>`<text x="180" y="${nameY+index*60}" font-size="${nameSize}" font-weight="600" font-family="'Card Display', 'IBM Plex Sans Condensed', sans-serif" letter-spacing="-1">${xml(line)}</text>`).join("")}
<text x="180" y="${missionY}" font-size="22" fill="#c7d0c9">${xml(mission)}</text>
<g transform="translate(1054 178) scale(1.25)" color="#c7d0c9" aria-hidden="true"><rect x="6" y="6" width="52" height="52" rx="12" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M20 6V2m24 4V2M2 25h4m52 14h4" stroke="currentColor" stroke-width="2"/><rect x="14" y="16" width="36" height="19" rx="8" fill="#192321" stroke="currentColor"/><rect x="${20+eyeOffset}" y="23" width="5" height="4" rx="1" fill="currentColor"/><rect x="${38-eyeOffset}" y="23" width="5" height="4" rx="1" fill="currentColor"/><path d="M17 45h30m-30 4h30M25 41v12m7-12v12m7-12v12" stroke="currentColor"/><rect x="15" y="55" width="7" height="5" rx="2" fill="currentColor"/><rect x="42" y="55" width="7" height="5" rx="2" fill="currentColor"/></g>
<path d="M64 374h1072M64 570h1072" stroke="#c7d0c9" stroke-opacity=".22"/>
<g font-family="'Card Mono', 'IBM Plex Mono', monospace">
<text x="64" y="414" font-size="16" letter-spacing="2" fill="#c7d0c9">FUNDS MOVED</text>
<text x="64" y="480" font-size="${fundsSize}" aria-label="${xml(usage.fundsMoved)}">${fundsLines.map((line,index)=>`<tspan x="64" dy="${index?fundsSize*1.25:0}">${xml(line)}</tspan>`).join("")}</text>
<text x="64" y="542" font-size="16" fill="#c7d0c9">${xml(symbol)} · SETTLED ONLY</text>
<text x="820" y="414" font-size="16" letter-spacing="2" fill="#c7d0c9">REQUESTS MADE</text><text x="820" y="480" font-size="56">${usage.requestCount.toLocaleString("en-US")}</text>
<text x="820" y="528" font-size="16" fill="#c7d0c9">${usage.paidCount.toLocaleString("en-US")} PAID / ${usage.blockedCount.toLocaleString("en-US")} BLOCKED</text>
<text x="64" y="610" font-size="15" letter-spacing="1" fill="#c7d0c9">AGENT VAULT</text><text x="64" y="644" font-size="21">${xml(short(agent.address))}</text>
<text x="500" y="610" font-size="15" letter-spacing="1" fill="#c7d0c9">POLICY COMMITMENT</text><text x="500" y="644" font-size="21">${xml(short(agent.policyHash))}</text>
<text x="1136" y="642" text-anchor="end" font-size="18" fill="${statusColor}">${xml(agent.status)}</text>
<text x="64" y="694" font-size="14" letter-spacing=".5" fill="#c7d0c9">${xml(disclosure)}</text>
<text x="64" y="722" font-size="13" fill="#c7d0c9">SNAPSHOT ${xml(snapshot)}</text><text x="1136" y="722" text-anchor="end" font-size="13" fill="#c7d0c9">${xml(provenance)}</text>
</g></g></svg>`;
}
