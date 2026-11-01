import type {Policy} from "@intentguard/shared";
import {emptySetup,inputLines,placeholderRecipient,budgetProseWarnings,type SetupFormValues} from "./agent-templates";

export type SetupMode="quick"|"manual";
export type SetupErrors=Record<string,string>;
export const setupSteps={quick:["Choose template","Customize","Review & activate"],manual:["Identity","Permissions","Money & validity","Review"]};
const identity=new Set(["name","mission","taskContext"]);
const money=new Set(["asset","destinationChainIds","totalBudget","perPaymentLimit","periodBudget","periodSeconds","start","end"]);
export function fieldStep(field:string){return identity.has(field)?0:money.has(field)?2:1;}
function decimal(value:string){if(!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))throw Error();const [whole,fraction=""]=value.split(".");const amount=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0"));if(amount>18446744073709551615n||amount<=0n)throw Error();return amount;}
export function publicOrigin(value:string){try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&!u.hash&&!u.search&&["","/"].includes(u.pathname)&&(!u.port||u.port==="443")&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(u.hostname)&&u.hostname.includes(".")&&!/^[0-9.]+$/.test(u.hostname)&&!u.hostname.endsWith(".")&&!/(^|\.)(localhost|local|internal)$/i.test(u.hostname)&&!value.includes("\\");}catch{return false;}}
function utcSeconds(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))return NaN;const milliseconds=Date.parse(value+"Z");if(!Number.isFinite(milliseconds)||milliseconds<0)return NaN;const normalized=new Date(milliseconds).toISOString().slice(0,value.length);return normalized===value?milliseconds/1000:NaN;}
export function setupGuidance(form:SetupFormValues):Policy{
 return {version:1,name:form.name.trim(),mission:form.mission.trim(),taskContext:form.taskContext.trim(),allowedCategories:inputLines(form.categories),prohibitedPurchases:inputLines(form.prohibited),exceptions:inputLines(form.exceptions),financial:{totalBudget:form.totalBudget,perPaymentLimit:form.perPaymentLimit,periodBudget:form.periodBudget,periodSeconds:Number(form.periodSeconds),validFrom:utcSeconds(form.start),validUntil:utcSeconds(form.end)},merchants:form.merchants.map(m=>({name:m.name.trim(),recipient:m.recipient,origins:inputLines(m.origins),products:inputLines(m.products)})),evidence:{requiredTypes:inputLines(form.evidenceTypes),approvedOrigins:inputLines(form.approvedOrigins),maxAgeSeconds:Number(form.maxAgeSeconds)},criteria:form.criteria.map(c=>({id:c.id,description:c.description.trim()}))};
}
export function validateSetup(form:SetupFormValues,step?:number):SetupErrors{
 const errors:SetupErrors={};
 if(!form.name.trim()||form.name.length>80)errors.name="Use an agent name of 1–80 characters.";
 if(form.mission.trim().length<10||form.mission.length>4000)errors.mission="Describe the mission in 10–4,000 characters.";
 if(form.taskContext.length>6000)errors.taskContext="Keep context within 6,000 characters.";
 for(const [field,min,max,length]of [["categories",1,20,200],["prohibited",0,20,500],["exceptions",0,20,500],["evidenceTypes",1,10,200],["approvedOrigins",1,30,2048]] as const){const values=inputLines(form[field]);if(values.length<min||values.length>max||values.some(v=>v.length>length))errors[field]=`Use ${min}–${max} entries, each within ${length} characters.`;}
 if(!form.merchants.length||form.merchants.length>32)errors.merchants="Approve between one and 32 merchants.";
 if(new Set(form.merchants.map(m=>m.recipient.toLowerCase())).size!==form.merchants.length)errors["merchant-0-recipient"]="Merchant recipients must be unique.";
 form.merchants.forEach((merchant,index)=>{
  const key=(field:string)=>"merchant-"+index+"-"+field;
  if(!merchant.name.trim()||merchant.name.length>100||merchant.example&&/^Example (?:research publisher|API provider)$/.test(merchant.name))errors[key("name")]="Enter your approved merchant’s name.";
  if(!/^0x[0-9a-fA-F]{40}$/.test(merchant.recipient)||placeholderRecipient(merchant.recipient))errors[key("recipient")]="Replace the example with your merchant’s verified recipient address.";
  const origins=inputLines(merchant.origins);if(!origins.length||origins.length>10||origins.some(value=>!publicOrigin(value)||/\.(?:example|invalid|test)\/?$/.test(value)||/^https:\/\/(?:[^/]+\.)?example\.(?:com|net|org)\/?$/.test(value)))errors[key("origins")]="Replace the example with verified HTTPS merchant origins.";
  const products=inputLines(merchant.products);if(products.length>30||products.some(value=>value.length>200))errors[key("products")]="Use at most 30 products, each within 200 characters.";
 });
 if(inputLines(form.approvedOrigins).some(value=>!publicOrigin(value)))errors.approvedOrigins="Use public HTTPS evidence origins without paths or queries.";
 const freshness=Number(form.maxAgeSeconds);if(!Number.isSafeInteger(freshness)||freshness<1||freshness>31536000)errors.maxAgeSeconds="Use 1–31,536,000 seconds for evidence freshness.";
 if(!form.criteria.length||form.criteria.length>12)errors.criteria="Include between one and 12 required criteria.";
 if(new Set(form.criteria.map(c=>c.id)).size!==form.criteria.length)errors.criteria="Criterion IDs must be unique.";
 form.criteria.forEach((criterion,index)=>{if(!/^[a-zA-Z0-9_-]{1,40}$/.test(criterion.id))errors["criterion-"+index+"-id"]="Use 1–40 letters, numbers, underscores or hyphens.";if(criterion.description.trim().length<3||criterion.description.length>1000)errors["criterion-"+index+"-description"]="Describe the check in 3–1,000 characters.";});
 for(const field of ["totalBudget","perPaymentLimit","periodBudget"] as const)try{decimal(form[field]);}catch{errors[field]="Use a positive exact amount with up to six decimal places.";}
 try{if(decimal(form.perPaymentLimit)>decimal(form.totalBudget))errors.perPaymentLimit="A payment limit cannot exceed the lifetime budget.";}catch{}
 const period=Number(form.periodSeconds);if(!Number.isSafeInteger(period)||period<60||period>31536000)errors.periodSeconds="Use a period of 60–31,536,000 seconds.";
 if(!["USDC","USDT0"].includes(form.asset))errors.asset="Choose a supported deposit asset.";
 if(!form.destinationChainIds.length||new Set(form.destinationChainIds).size!==form.destinationChainIds.length||form.destinationChainIds.some(id=>!Number.isSafeInteger(id)||id<1))errors.destinationChainIds="Approve at least one verified spending network.";
 const start=utcSeconds(form.start),end=utcSeconds(form.end);if(!Number.isFinite(start))errors.start="Choose a valid UTC start date.";if(!Number.isFinite(end)||end<=start)errors.end="Choose a valid expiry after the start date.";
 const warnings=budgetProseWarnings(form);if(warnings.length)errors.mission=warnings[0];
 return step===undefined?errors:Object.fromEntries(Object.entries(errors).filter(([field])=>fieldStep(field)===step));
}
export function updateMerchantOrigin(form:SetupFormValues,index:number,origins:string):SetupFormValues{
 const previous=inputLines(form.merchants[index].origins),other=form.merchants.filter((_,i)=>i!==index).flatMap(m=>inputLines(m.origins));
 const approved=inputLines(form.approvedOrigins).filter(origin=>!previous.includes(origin)||other.includes(origin));
 return {...form,merchants:form.merchants.map((merchant,i)=>i===index?{...merchant,origins}:merchant),approvedOrigins:[...new Set([...approved,...inputLines(origins)])].join("\n")};
}
export function apiSetupErrors(details:unknown):SetupErrors{
 const issues=Array.isArray(details)?details:details&&typeof details==="object"?(details as {issues?:unknown}).issues:undefined;
 if(!Array.isArray(issues))return {};
 const names:Record<string,string>={"financial.validFrom":"start","financial.validUntil":"end","allowedCategories":"categories","prohibitedPurchases":"prohibited","exceptions":"exceptions","evidence.requiredTypes":"evidenceTypes","evidence.approvedOrigins":"approvedOrigins","evidence.maxAgeSeconds":"maxAgeSeconds"};
 const errors:SetupErrors={};for(const issue of issues){if(!issue||typeof issue!=="object"||typeof issue.message!=="string")continue;const path=Array.isArray(issue.path)?issue.path.join("."):issue.field;if(typeof path!=="string")continue;const field=names[path]||path.replace(/^financial\./,"").replace(/^merchants\.(\d+)\./,"merchant-$1-").replace(/^criteria\.(\d+)\./,"criterion-$1-");errors[field]=issue.message.slice(0,500);}return errors;
}
/** Rehydrate only known form data; no tokens, signatures, keys or arbitrary object properties. */
export function restoreSetupForm(saved:unknown):SetupFormValues{
 if(!saved||typeof saved!=="object"||Array.isArray(saved))throw Error("Saved form could not be restored. Check your inputs.");
 const source=saved as Record<string,unknown>,form=emptySetup();
 for(const key of Object.keys(form) as (keyof SetupFormValues)[]){if(["asset","destinationChainIds","merchants","criteria"].includes(key))continue;if(source[key]!==undefined){if(typeof source[key]!=="string"||(source[key] as string).length>12000)throw Error("Saved form has invalid fields.");(form as unknown as Record<string,unknown>)[key]=source[key];}}
 if(source.asset!==undefined&&!['USDC','USDT0'].includes(source.asset as string))throw Error("Saved asset is invalid.");form.asset=source.asset as SetupFormValues["asset"]||"USDC";
 if(source.destinationChainIds!==undefined){if(!Array.isArray(source.destinationChainIds)||source.destinationChainIds.length>11||source.destinationChainIds.some(id=>!Number.isSafeInteger(id)))throw Error("Saved networks are invalid.");form.destinationChainIds=[...source.destinationChainIds];}
 for(const [key,fields,max]of [["merchants",["name","recipient","origins","products"],32],["criteria",["id","description"],12]] as const){if(source[key]===undefined)continue;const rows=source[key];if(!Array.isArray(rows)||!rows.length||rows.length>max||rows.some(row=>!row||typeof row!=="object"||fields.some(field=>typeof row[field]!=="string"||row[field].length>12000)))throw Error("Saved permission rows are invalid.");(form as unknown as Record<string,unknown>)[key]=rows.map(row=>({...Object.fromEntries(fields.map(field=>[field,row[field]])),...(key==="merchants"&&row.example===true?{example:true}:{})}));}
 return form;
}
