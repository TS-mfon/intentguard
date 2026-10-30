import assert from "node:assert/strict";
import {test} from "node:test";
import {policySchema} from "../packages/shared";
import {policy} from "./fixtures";
import {agentTemplates,emptySetup,setupFromTemplate,restoreGuidedSetup,placeholderRecipient,budgetProseWarnings,inputLines} from "../apps/web/components/agent-templates";

test("Templates require owner-supplied merchant details and yield valid editable permissions",()=>{
 for(const template of agentTemplates){
  const form=setupFromTemplate(template.id,1952,1793340000000);
  assert.equal(form.merchants[0].recipient,"");assert.equal(form.approvedOrigins,"");
  const permission=policySchema.parse({...policy,name:form.name,mission:form.mission,taskContext:form.taskContext,allowedCategories:inputLines(form.categories),prohibitedPurchases:inputLines(form.prohibited),criteria:form.criteria,financial:{...policy.financial,totalBudget:form.totalBudget,perPaymentLimit:form.perPaymentLimit,periodBudget:form.periodBudget,periodSeconds:Number(form.periodSeconds)}});
  assert.equal(permission.financial.perPaymentLimit,"0.01");assert.equal(permission.financial.periodSeconds,86400);
  form.criteria[0].description="Owner edit";assert.notEqual(setupFromTemplate(template.id,1952).criteria[0].description,"Owner edit");
 }
});
test("Protocol test template cannot be selected for mainnet payments",()=>{
 assert.throws(()=>setupFromTemplate("protocol-test",196),/requires X Layer testnet/);
 assert.deepEqual(setupFromTemplate("research",196).destinationChainIds,[196]);
});
test("Failed draft restores exact owner amounts, merchants and UTC validity",()=>{
 const guided=structuredClone(policy);guided.financial.periodBudget="500";guided.financial.periodSeconds=604800;
 const restored=restoreGuidedSetup({description:guided.mission,guidance:guided},emptySetup(),"USDC",[1952]);
 assert.equal(restored.periodBudget,"500");assert.equal(restored.periodSeconds,"604800");assert.equal(restored.merchants[0].recipient,guided.merchants[0].recipient);
 assert.equal(Date.parse(restored.end+"Z")/1000,Math.floor(guided.financial.validUntil/60)*60);
});
test("Malformed guided drafts produce actionable errors before rendering",()=>{
 for(const mutate of [(p:any)=>p.financial.validUntil=Number.MAX_SAFE_INTEGER,(p:any)=>p.merchants=[null],(p:any)=>p.criteria=[null],(p:any)=>p.evidence=null]){
  const bad=structuredClone(policy);mutate(bad);assert.throws(()=>restoreGuidedSetup({guidance:bad},emptySetup(),"USDC",[1952]));
 }
 assert.equal(restoreGuidedSetup({description:"Original instructions"},emptySetup(),"USDC",[1952]).mission,"Original instructions");
});
test("Guidance identifies a duplicate budget period and placeholder recipients",()=>{
 assert.equal(budgetProseWarnings({mission:"Buy reports for 250 USDC/day",taskContext:"",criteria:[]}).length,1);
 assert.equal(budgetProseWarnings({mission:"Buy approved reports",taskContext:"",criteria:[{id:"budget",description:"Spend 500 USDC per week"}]}).length,1);
 assert.equal(budgetProseWarnings({mission:"Buy approved reports",taskContext:"",criteria:[]}).length,0);
 assert.equal(placeholderRecipient("0x"+"1".repeat(40)),true);assert.equal(placeholderRecipient("0x1234567890123456789012345678901234567890"),false);
});
