"use client";
import {useEffect,useRef,useState} from "react";
import {api,errorMessage,browserDigest} from "./client";
import {useRuntime} from "./runtime";
import {Button,Notice} from "./primitives";
import {Download,FileCheck2} from "lucide-react";
type ProofBundle={id:string;proof:Record<string,unknown>;proofHash:string;verification:string};
export function BridgeProof({id}:{id:string}){
 const{config}=useRuntime(),[proof,setProof]=useState<ProofBundle|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const generation=useRef(0);
 useEffect(()=>{generation.current++;setProof(null);setError("");setBusy(false);return()=>{generation.current++;};},[id,config?.mode]);
 async function load(){const attempt=++generation.current;setProof(null);setBusy(true);setError("");try{const value=await api<ProofBundle>("/explorer/transactions/"+encodeURIComponent(id)+"/proof");if(value.id!==id||!value.proof||await browserDigest(value.proof)!==value.proofHash||value.proof.requestId!==id||value.proof.paymentEnvironment!==config?.mode||value.proof.sourceChainId!==config?.chainId)throw Error("The captured proof does not match this transaction or deployment.");if(attempt===generation.current)setProof(value);}catch(e){if(attempt===generation.current)setError(errorMessage(e));}finally{if(attempt===generation.current)setBusy(false);}}
 function download(){if(!proof)return;const url=URL.createObjectURL(new Blob([JSON.stringify(proof,null,2)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="intentguard-cctp-proof-"+id+".json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="bridge-proof"><h3>Delivery proof bundle</h3><p>Source burn, Circle message and attestation, destination mint and the signed acknowledgement digest. The worker captures this public evidence; independently verify its receipts.</p><Button variant="secondary" busy={busy} onClick={()=>void load()}><FileCheck2 size={16}/>{proof?"Refresh proof":"Inspect delivery proof"}</Button>{error?<Notice tone="error">{error}</Notice>:null}{proof?<><p className="field-help">{proof.verification}</p><dl className="metadata-grid"><div><dt>Proof commitment</dt><dd><code className="break">{proof.proofHash}</code></dd></div><div><dt>Source chain</dt><dd>{String(proof.proof.sourceChainId)}</dd></div><div><dt>Destination chain</dt><dd>{String(proof.proof.destinationChainId)}</dd></div></dl><p className="field-help">{String(proof.proof.trustBoundary||"Destination delivery relies on the configured attestor; X Layer does not verify foreign-chain consensus.")}</p><details><summary>Public proof JSON</summary><pre className="proof-json">{JSON.stringify(proof,null,2)}</pre></details><Button variant="ghost" onClick={download}><Download size={16}/>Download proof JSON</Button></>:null}</section>;
}
