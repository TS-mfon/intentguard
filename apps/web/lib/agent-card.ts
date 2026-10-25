import {configuration} from "./config";
import type {Card} from "./models";
import type {Store} from "./store";
export async function agentUsage(store:Store,card:Card){
 const {counts,fundsMoved}=await store.usage(card._id),count=(s:string)=>counts[s]??0;
 return {requestCount:Object.values(counts).reduce((a,b)=>a+b,0),paidCount:count("PAID"),blockedCount:count("BLOCKED"),rejectedCount:count("REJECTED"),needsEvidenceCount:count("NEEDS_EVIDENCE"),cancelledCount:count("CANCELLED"),activeCount:["QUEUED","RESERVED","REVIEWING","AWAITING_FINALITY","APPROVED","RETRYING"].reduce((n,s)=>n+count(s),0),fundsMoved,token:String(card.token??configuration().token),chainId:Number(card.chainId??configuration().chainId),asOf:Date.now()};
}
export type AgentUsage=Awaited<ReturnType<typeof agentUsage>>;
const xml=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export function cardSvg(agent:{id:string;name:string;mission:string;address:string;policyHash:string;status:string},usage:AgentUsage,symbol:string){
 const name=agent.name.length>35?agent.name.slice(0,32)+"…":agent.name,mission=agent.mission.length>94?agent.mission.slice(0,91)+"…":agent.mission;
 const short=(v:string)=>v.slice(0,10)+"…"+v.slice(-8);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-labelledby="title desc">
<title id="title">${xml(agent.name)} IntentGuard ATM agent card</title><desc id="desc">Snapshot of actual admitted requests and settled ${xml(symbol)} transfers on X Layer ${usage.chainId}. No API credentials are included.</desc>
<defs><linearGradient id="metal" x2="1" y2="1"><stop stop-color="#26332f"/><stop offset=".5" stop-color="#192321"/><stop offset="1" stop-color="#101716"/></linearGradient><pattern id="engrave" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 7.5H8" stroke="#edf2ec" stroke-opacity=".035"/></pattern></defs>
<rect width="1200" height="760" rx="32" fill="url(#metal)"/><rect width="1200" height="760" rx="32" fill="url(#engrave)"/><rect x="20" y="20" width="1160" height="720" rx="20" fill="none" stroke="#526359"/>
<g color="#b5d7ae" transform="translate(64 60) scale(1.4)"><path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/><path d="M5 20h30" stroke="currentColor" stroke-width="3"/><path d="M20 8v24" stroke="currentColor" stroke-width="2" stroke-dasharray="3 5"/></g>
<g fill="#edf2ec" font-family="sans-serif"><text x="126" y="95" font-size="28" font-weight="600">IntentGuard</text><text x="1136" y="94" text-anchor="end" font-size="19" letter-spacing="3">ATM / AGENT IDENTITY</text>
<g transform="translate(64 156)" fill="none" stroke="#b5d7ae" stroke-width="2"><rect width="86" height="68" rx="10"/><path d="M28 0v68m30-68v68M0 23h28m30 0h28M0 45h28m30 0h28M28 23h30v22H28z"/></g>
<text x="64" y="302" font-size="52" font-weight="600">${xml(name)}</text><text x="64" y="344" font-size="20" fill="#b2beb5">${xml(mission)}</text>
<path d="M64 390h1072M64 546h1072" stroke="#526359"/>
<text x="64" y="428" font-size="16" letter-spacing="2" fill="#b2beb5">REQUESTS MADE</text><text x="64" y="502" font-size="60" font-weight="600">${usage.requestCount}</text>
<text x="386" y="428" font-size="16" letter-spacing="2" fill="#b2beb5">FUNDS MOVED</text><text x="386" y="492" font-size="38" font-weight="600">${xml(usage.fundsMoved)}</text><text x="386" y="523" font-size="16" fill="#b2beb5">${xml(symbol)} • SETTLED ONLY</text>
<text x="896" y="428" font-size="16" letter-spacing="2" fill="#b2beb5">PAID / BLOCKED</text><text x="896" y="502" font-size="44">${usage.paidCount} / ${usage.blockedCount}</text>
<text x="64" y="588" font-size="15" fill="#b2beb5">AGENT VAULT</text><text x="64" y="620" font-size="22" font-family="monospace">${xml(short(agent.address))}</text>
<text x="536" y="588" font-size="15" fill="#b2beb5">POLICY COMMITMENT</text><text x="536" y="620" font-size="20" font-family="monospace">${xml(short(agent.policyHash))}</text>
<text x="1136" y="591" text-anchor="end" font-size="19" fill="#b5d7ae">${xml(agent.status)}</text><text x="1136" y="622" text-anchor="end" font-size="17">X LAYER ${usage.chainId}</text>
<text x="64" y="696" font-size="16" fill="#98a89c">TESTNET • NO MONETARY VALUE • ${xml(new Date(usage.asOf).toISOString())}</text><text x="1136" y="696" text-anchor="end" font-size="16" fill="#b2beb5">intentguard-tapeout.vercel.app</text>
</g></svg>`;
}
