"use client";
import {agentTemplates,type AgentTemplateId} from "./agent-templates";

export function AgentTemplatePicker({value,onChange,chainId}:{value:AgentTemplateId|"custom";onChange:(id:AgentTemplateId|"custom")=>void;chainId?:number}){
 return <fieldset className="agent-template-picker"><legend>Start from a template</legend><p className="field-help">Choose a purpose, then edit the exact terms. Add your verified merchant address and HTTPS evidence origin before submitting.</p><div className="template-options">
  <label className={value==="custom"?"selected":""}><input type="radio" name="agent-template" value="custom" checked={value==="custom"} onChange={()=>onChange("custom")}/><span><strong>Custom permission</strong><span>Define your own assignment and spending boundaries.</span></span></label>
  {agentTemplates.filter(template=>template.id!=="protocol-test"||chainId===1952).map(template=><label key={template.id} className={value===template.id?"selected":""}><input type="radio" name="agent-template" value={template.id} checked={value===template.id} onChange={()=>onChange(template.id)}/><span><strong>{template.name}</strong><span>{template.description}</span><small>Starting limits: 1 USDC lifetime · 0.01 per payment · 0.1 per day</small></span></label>)}
 </div></fieldset>;
}
