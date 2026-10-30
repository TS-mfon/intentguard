"use client";
import {useId,useState} from "react";
import {ArrowUpRight,Download,Image as ImageIcon,RefreshCw} from "lucide-react";
import {amount,date,errorMessage,short,paymentSymbol,apiResponse} from "./client";
import {Button,Notice,Status} from "./primitives";
import {useResource,useRuntime} from "./runtime";
import {AgentIdentity,BrandMark} from "./brand";
import {CardTilt} from "./motion";
import {cardChipMarkup,cardMaterialMarkup} from "../lib/agent-card-art";
import styles from "./agent-card.module.css";

export type AgentCardData={
  agent:{id:string;name:string;mission:string;address:string;owner:string;policyHash:string;chainId:number;token:string;paymentSymbol?:string;settlement?:import("./client").Settlement;status:string;createdAt:number};
  usage:{requestCount:number;paidCount:number;blockedCount:number;rejectedCount:number;needsEvidenceCount:number;cancelledCount:number;activeCount:number;fundsMoved:string;token:string;chainId:number;asOf:number|string};
  shareUrl:string;
};
export function CardDownload({id,compact=false}:{id:string;compact?:boolean}) {
  const path="/explorer/agents/"+encodeURIComponent(id)+"/card";
  const resource=useResource<AgentCardData>(path,30000),{config}=useRuntime();
  const[busy,setBusy]=useState<"svg"|"png"|null>(null),[error,setError]=useState("");
  const artId=useId();
  const data=resource.data,symbol=paymentSymbol(data?.agent,config);
  async function download(format:"svg"|"png"){
    setBusy(format);setError("");
    let imageUrl:string|undefined,downloadUrl:string|undefined;
    try{
      const response=await apiResponse(path+".svg",{signal:AbortSignal.timeout(20000)});
      if(!response.ok){const body=await response.json().catch(()=>null);throw Error(body?.error?body.error.code+": "+body.error.message+(body.error.requestId?" · Reference "+body.error.requestId:""):"Card download failed. Retry in a moment.")}
      if(!response.headers.get("Content-Type")?.includes("image/svg+xml"))throw Error("The service returned an unexpected card format.");
      const blob=await response.blob();
      let asset=blob;
      if(format==="png"){
        imageUrl=URL.createObjectURL(blob);
        const source=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();const timeout=setTimeout(()=>reject(Error("Card image decoding timed out. Retry or download SVG.")),10000);img.onload=()=>{clearTimeout(timeout);resolve(img)};img.onerror=()=>{clearTimeout(timeout);reject(Error("The card image could not be exported. Download SVG instead."))};img.src=imageUrl!});
        const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=760;
        const ctx=canvas.getContext("2d");if(!ctx)throw Error("PNG export is unavailable in this browser. Download SVG instead.");
        ctx.drawImage(source,0,0,1200,760);
        asset=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("PNG export failed. Download SVG instead.")),"image/png"));
      }
      downloadUrl=URL.createObjectURL(asset);
      const link=document.createElement("a");link.href=downloadUrl;link.download="intentguard-"+(data?.agent.name||id).replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,80)+"."+format;document.body.appendChild(link);link.click();link.remove();
    }catch(e){setError(errorMessage(e))}
    finally{if(imageUrl)URL.revokeObjectURL(imageUrl);if(downloadUrl)setTimeout(()=>URL.revokeObjectURL(downloadUrl!),1000);setBusy(null)}
  }
  return <section className={"issued-identity "+styles.identity+" "+(compact?"identity-compact "+styles.compact:"")} aria-label="Downloadable agent identity" aria-busy={resource.loading}>
    {resource.error?<><Notice tone="error">{resource.error}</Notice><Button variant="secondary" onClick={()=>void resource.reload()}><RefreshCw size={16}/>Retry card</Button></>:resource.loading?<div className={"identity-loading "+styles.loading}><div className="skeleton card-skeleton" role="status">Loading measured agent usage…</div></div>:data?<>
      <div className={styles.stage}><BrandMark size={240} className={styles.stageMark}/><CardTilt><div className={"atm-card "+styles.card}>
        <svg className={styles.material} viewBox="0 0 1200 760" preserveAspectRatio="none" aria-hidden="true" dangerouslySetInnerHTML={{__html:cardMaterialMarkup(artId)}}/>
        <div className={"atm-heading "+styles.heading}><span className={"atm-brand "+styles.brand}><BrandMark size={24}/>IntentGuard</span><span className={styles.designation}>AGENT CARD<span>X LAYER {data.agent.chainId} · {data.agent.chainId===1952?"TESTNET":data.agent.chainId===196?"MAINNET":"LOCAL"}</span></span></div>
        <div className={"atm-identity-row "+styles.identityRow}><svg className={"card-chip "+styles.chip} viewBox="0 0 64 48" aria-hidden="true" dangerouslySetInnerHTML={{__html:cardChipMarkup(artId+"chip")}}/><div className={"atm-agent "+styles.agent}><span className={styles.label}>ISSUED TO</span><h3 title={data.agent.name}>{data.agent.name}</h3><p className={styles.mission} title={data.agent.mission}>{data.agent.mission}</p></div><span className={styles.seal}><AgentIdentity seed={data.agent.id} size={44}/></span></div>
        <div className={"atm-usage "+styles.usage}><div className={styles.funds}><span className={styles.label}>FUNDS MOVED</span><strong title={data.usage.fundsMoved+" "+symbol}>{amount(data.usage.fundsMoved)}</strong><small>{symbol} · SETTLED ONLY</small></div><div className={styles.requests}><span className={styles.label}>REQUESTS MADE</span><strong>{data.usage.requestCount.toLocaleString()}</strong></div></div>
        <div className={"atm-footer "+styles.footer}><div><span className={styles.label}>AGENT VAULT</span><span className="mono" title={data.agent.address}>{short(data.agent.address,10)}</span></div><div className={styles.policy}><span className={styles.label}>POLICY COMMITMENT</span><span className="mono" title={data.agent.policyHash}>{short(data.agent.policyHash,8)}</span></div><Status status={data.agent.status}/></div>
        <p className={styles.disclosure}>{data.agent.chainId===1952?"TESTNET · NO MONETARY VALUE":data.agent.chainId===196?"MAINNET PAYMENTS · STUDIONET TESTNET REVIEW":"LOCAL TEST PAYMENTS · NO MONETARY VALUE"}</p>
      </div></CardTilt></div>{!compact?<div className="identity-meta"><p>{data.agent.mission}</p><dl className="usage-strip"><div><dt>Paid</dt><dd>{data.usage.paidCount}</dd></div><div><dt>Blocked</dt><dd>{data.usage.blockedCount}</dd></div><div><dt>Rejected</dt><dd>{data.usage.rejectedCount}</dd></div><div><dt>Needs evidence</dt><dd>{data.usage.needsEvidenceCount}</dd></div></dl><p className="identity-snapshot">Actual admitted requests. Funds moved includes confirmed paid transfers only.<br/>Snapshot {typeof data.usage.asOf==="string"?new Date(data.usage.asOf).toLocaleString():date(data.usage.asOf,true)} · X Layer {data.agent.chainId} · {data.agent.chainId===1952?symbol+" testnet tokens have no monetary value.":data.agent.chainId===196?symbol+" mainnet payments; Studionet testnet review.":"Local test payments have no monetary value."}</p></div>:<p className="identity-snapshot">Actual admitted requests · Snapshot {typeof data.usage.asOf==="string"?new Date(data.usage.asOf).toLocaleString():date(data.usage.asOf,true)} · {symbol} · {data.agent.chainId===1952?"testnet payments":data.agent.chainId===196?"mainnet payments":"local test payments"}</p>}
      <div className="identity-actions"><Button variant="secondary" busy={busy==="svg"} disabled={!!busy} onClick={()=>void download("svg")}><Download size={16}/>Download card</Button><Button variant="ghost" busy={busy==="png"} disabled={!!busy} onClick={()=>void download("png")}><ImageIcon size={16}/>PNG</Button><a className="button button-ghost" href={"https://twitter.com/intent/tweet?text="+encodeURIComponent(data.agent.name+" has made "+data.usage.requestCount+" requests and moved "+data.usage.fundsMoved+" "+symbol+" on "+(data.agent.chainId===1952?"X Layer testnet":"X Layer mainnet")+" with IntentGuard. Owner-defined limits. Studionet testnet review.")+"&url="+encodeURIComponent(data.shareUrl)} target="_blank" rel="noreferrer">Share on X<ArrowUpRight size={16}/></a></div>
      {!compact?<p className="field-help">Download the card, then attach it to your post in X. The share link opens a composer with this agent’s public record.</p>:null}
    </>:null}
    {error?<Notice tone="error">{error}</Notice>:null}
  </section>;
}
