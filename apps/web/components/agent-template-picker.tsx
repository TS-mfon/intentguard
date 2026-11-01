"use client";
import {agentTemplates,type AgentTemplateId} from "./agent-templates";

export function AgentTemplatePicker({value,onChange,chainId,protocolAvailable=false}:{value:AgentTemplateId|"custom";onChange:(id:AgentTemplateId|"custom")=>void;chainId?:number;protocolAvailable?:boolean}){
 return <fieldset className="agent-template-picker"><legend>Choose a starting policy</legend><div className="template-options">
  <label className={value==="custom"?"selected":""}><input type="radio" name="agent-template" value="custom" checked={value==="custom"} onChange={()=>onChange("custom")}/><span><strong>Custom permission</strong><span>Define your own assignment and spending boundaries.</span></span></label>
  {agentTemplates.filter(template=>template.id!=="protocol-test"||chainId===1952).map(template=><label key={template.id} className={value===template.id?"selected":""}><input type="radio" name="agent-template" value={template.id} checked={value===template.id} disabled={template.id==="protocol-test"&&!protocolAvailable} onChange={()=>onChange(template.id)}/><span><strong>{template.name}</strong><span>{template.description}</span><small>{template.id==="protocol-test"?protocolAvailable?"Configured testnet merchant · ready to customize":"Test merchant unavailable on this deployment":"Complete example · replace merchant details"}</small></span></label>)}
 </div></fieldset>;
}
