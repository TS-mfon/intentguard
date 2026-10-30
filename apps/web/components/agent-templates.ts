import type {Policy} from "@intentguard/shared";

export type MerchantForm={name:string;recipient:string;origins:string;products:string};
export type CriterionForm={id:string;description:string};
export type SetupFormValues={asset:"USDC"|"USDT0";destinationChainIds:number[];name:string;mission:string;taskContext:string;categories:string;prohibited:string;exceptions:string;totalBudget:string;perPaymentLimit:string;periodBudget:string;periodSeconds:string;start:string;end:string;merchants:MerchantForm[];evidenceTypes:string;approvedOrigins:string;maxAgeSeconds:string;criteria:CriterionForm[]};
export const inputLines=(value:string)=>value.split(/[\n,]/).map(part=>part.trim()).filter(Boolean);

export function emptySetup(now=Date.now()):SetupFormValues{
 return {asset:"USDC",destinationChainIds:[],name:"",mission:"",taskContext:"",categories:"",prohibited:"",exceptions:"",totalBudget:"",perPaymentLimit:"",periodBudget:"",periodSeconds:"86400",start:new Date(now).toISOString().slice(0,16),end:new Date(now+30*86400000).toISOString().slice(0,16),merchants:[{name:"",recipient:"",origins:"",products:""}],evidenceTypes:"Merchant invoice\nProduct description",approvedOrigins:"",maxAgeSeconds:"86400",criteria:[{id:"mission",description:"The purchase directly supports the assigned mission."},{id:"invoice",description:"An approved merchant invoice matches the buyer vault, recipient, token, destination and exact requested amount."}]};
}

export const agentTemplates=[
 {id:"research",name:"Research assistant",description:"Buy reports and licensed datasets from a merchant you approve.",mission:"Purchase research reports and licensed datasets for the assigned project from approved merchants.",taskContext:"Prepare a sourced research brief. Each purchase must contribute directly to that brief.",categories:"Research reports\nLicensed datasets",prohibited:"Personal data for advertising\nUnrelated services",products:"Research reports\nLicensed datasets",criterion:"The report or dataset is relevant to the assigned research brief and has a clear product description."},
 {id:"api-access",name:"API access",description:"Buy documented API access for one defined integration.",mission:"Purchase documented API access needed to implement and test the assigned integration.",taskContext:"Use approved API providers. Require an invoice and documentation identifying the service being purchased.",categories:"API access",prohibited:"Unrelated subscriptions\nPersonal data for advertising",products:"API access",criterion:"The API service supports the assigned integration and the evidence identifies the service and access being purchased."},
 {id:"protocol-test",name:"Protocol test",description:"Exercise a small testnet service purchase and its refusal cases.",mission:"Verify native testnet USDC service settlement to an explicitly approved protocol test merchant.",taskContext:"Test allowed settlement, an excessive amount, a prohibited purpose and an invoice with the wrong buyer. Testnet tokens have no monetary value.",categories:"protocol-verification",prohibited:"Personal data for advertising\nUnrelated services",products:"Native USDC settlement verification",criterion:"The product is a native testnet USDC settlement verification service from the approved protocol test merchant."}
] as const;
export type AgentTemplateId=typeof agentTemplates[number]["id"];

export function setupFromTemplate(id:AgentTemplateId,chainId:number,now=Date.now()):SetupFormValues{
 const template=agentTemplates.find(item=>item.id===id);
 if(!template)throw Error("Unknown agent template");
 if(id==="protocol-test"&&chainId!==1952)throw Error("The protocol test template requires X Layer testnet.");
 const base=emptySetup(now);
 return {...base,name:template.name,mission:template.mission,taskContext:template.taskContext,categories:template.categories,prohibited:template.prohibited,totalBudget:"1",perPaymentLimit:"0.01",periodBudget:"0.1",destinationChainIds:[chainId],merchants:[{name:"",recipient:"",origins:"",products:template.products}],criteria:[...base.criteria,{id:"product",description:template.criterion}]};
}

export function setupFromPolicy(policy:Policy,asset:"USDC"|"USDT0",destinationChainIds:number[]):SetupFormValues{
 for(const timestamp of [policy.financial.validFrom,policy.financial.validUntil])if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>253402300799)throw Error("The saved validity dates cannot be displayed. Enter supported UTC dates before submitting a new draft.");
 return {asset,destinationChainIds:[...destinationChainIds],name:policy.name,mission:policy.mission,taskContext:policy.taskContext,categories:policy.allowedCategories.join("\n"),prohibited:policy.prohibitedPurchases.join("\n"),exceptions:policy.exceptions.join("\n"),totalBudget:policy.financial.totalBudget,perPaymentLimit:policy.financial.perPaymentLimit,periodBudget:policy.financial.periodBudget,periodSeconds:String(policy.financial.periodSeconds),start:new Date(policy.financial.validFrom*1000).toISOString().slice(0,16),end:new Date(policy.financial.validUntil*1000).toISOString().slice(0,16),merchants:policy.merchants.map(merchant=>({...merchant,origins:merchant.origins.join("\n"),products:merchant.products.join("\n")})),evidenceTypes:policy.evidence.requiredTypes.join("\n"),approvedOrigins:policy.evidence.approvedOrigins.join("\n"),maxAgeSeconds:String(policy.evidence.maxAgeSeconds),criteria:policy.criteria.map(criterion=>({...criterion}))};
}

export function restoreGuidedSetup(input:unknown,current:SetupFormValues,asset:"USDC"|"USDT0",destinations:number[]):SetupFormValues{
 if(!input||typeof input!=="object")return current;
 const value=input as {description?:unknown;guidance?:unknown};
 const policy=value.guidance as Policy|undefined;
 if(!policy||policy.version!==1)return typeof value.description==="string"?{...current,mission:value.description}:current;
 const strings=(items:unknown)=>Array.isArray(items)&&items.every(item=>typeof item==="string");
 if(typeof policy.name!=="string"||typeof policy.mission!=="string"||typeof policy.taskContext!=="string"||![policy.allowedCategories,policy.prohibitedPurchases,policy.exceptions,policy.evidence?.requiredTypes,policy.evidence?.approvedOrigins].every(strings)||!policy.financial||![policy.financial.totalBudget,policy.financial.perPaymentLimit,policy.financial.periodBudget].every(item=>typeof item==="string")||![policy.financial.periodSeconds,policy.financial.validFrom,policy.financial.validUntil,policy.evidence.maxAgeSeconds].every(Number.isSafeInteger)||!Array.isArray(policy.merchants)||!policy.merchants.length||!policy.merchants.every(merchant=>merchant&&typeof merchant.name==="string"&&typeof merchant.recipient==="string"&&strings(merchant.origins)&&strings(merchant.products))||!Array.isArray(policy.criteria)||!policy.criteria.length||!policy.criteria.every(criterion=>criterion&&typeof criterion.id==="string"&&typeof criterion.description==="string"))throw Error("The original guided policy could not be restored. Check the input fields before submitting a new draft.");
 return setupFromPolicy(policy,asset,destinations);
}

export const placeholderRecipient=(value:string)=>/^0x([0-9a-f])\1{39}$/i.test(value);

/** Flag explicit duplicate budget prose; money belongs in the financial controls. */
export function budgetProseWarnings(form:Pick<SetupFormValues,"mission"|"taskContext"|"criteria">):string[]{
 const text=[form.mission,form.taskContext,...form.criteria.map(item=>item.description)].join("\n");
 return /\b\d+(?:\.\d+)?\s*(?:USDC|USDT0|USDT|dollars?|USD)\s*(?:\/\s*(?:day|week|month)|per\s+(?:\d+\s+)?(?:days?|weeks?|months?|hours?)|a\s+(?:day|week|month)|(?:in\s+)?(?:daily|weekly|monthly))\b/i.test(text)
  ||/\b(?:daily|weekly|monthly)\b[^\n]{0,100}\b(?:budget|cap|limit|spending)\b[^\n]{0,60}\$?\s*\d+(?:\.\d+)?\s*(?:USDC|USDT0|USDT|dollars?|USD)\b/i.test(text)
  ?["A mission or criterion repeats a spending amount and period. Put every budget in Money & validity and remove the duplicate amount from the prose; conflicting limits can prevent validator agreement."]:[];
}
