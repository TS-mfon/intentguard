import assert from "node:assert/strict";
import {test} from "node:test";
import {policySchema} from "../packages/shared";
import {policy} from "./fixtures";
import {agentTemplates,emptySetup,setupFromTemplate,restoreGuidedSetup,placeholderRecipient,budgetProseWarnings,inputLines,EXAMPLE_RECIPIENT} from "../apps/web/components/agent-templates";
import {setupGuidance,validateSetup,updateMerchantOrigin} from "../apps/web/components/setup-form";

test("complete templates include every permission section and require replacement of merchant examples",()=>{
 for(const template of agentTemplates){
  const form=setupFromTemplate(template.id,1952,1793340000000);
  assert.ok(form.merchants[0].name);assert.ok(form.merchants[0].recipient);assert.ok(form.approvedOrigins);assert.ok(form.start);assert.ok(form.end);assert.ok(form.evidenceTypes);assert.ok(form.criteria.length>=3);assert.equal(form.exceptions,"");
  assert.ok(validateSetup(form)["merchant-0-recipient"]);
  form.merchants[0].name="Approved data provider";form.merchants[0].recipient="0x1234567890123456789012345678901234567890";
  const completed=updateMerchantOrigin(form,0,"https://data.provider.com");assert.deepEqual(validateSetup(completed),{});
  const permission=policySchema.parse(setupGuidance(completed));
  assert.equal(permission.financial.perPaymentLimit,"0.01");assert.equal(permission.financial.periodSeconds,86400);
  form.criteria[0].description="Owner edit";assert.notEqual(setupFromTemplate(template.id,1952).criteria[0].description,"Owner edit");
 }
});
test("Protocol test template cannot be selected for mainnet payments",()=>{
 assert.throws(()=>setupFromTemplate("protocol-test",196),/requires X Layer testnet/);
 assert.deepEqual(setupFromTemplate("research",196).destinationChainIds,[196]);
});
test("Failed draft restores exact owner amounts, merchants and UTC validity",()=>{
 const guided=structuredClone(policy);guided.financial.periodBudget="500";guided.financial.periodSeconds=604800;guided.financial.validUntil+=17;
 const restored=restoreGuidedSetup({description:guided.mission,guidance:guided},emptySetup(),"USDC",[1952]);
 assert.equal(restored.periodBudget,"500");assert.equal(restored.periodSeconds,"604800");assert.equal(restored.merchants[0].recipient,guided.merchants[0].recipient);
 assert.equal(Date.parse(restored.end+"Z")/1000,guided.financial.validUntil);
});
test("protocol template binds the configured testnet merchant without any example recipient",()=>{
 const merchant={name:"Protocol verification service",recipient:"0x1234567890123456789012345678901234567890",origin:"https://intentguard.test.vendor",products:["Native USDC settlement verification"]};
 const form=setupFromTemplate("protocol-test",1952,1793340000000,merchant);
 assert.deepEqual(validateSetup(form),{});const permission=policySchema.parse(setupGuidance(form));assert.equal(permission.merchants[0].recipient,merchant.recipient);assert.deepEqual(permission.merchants[0].origins,[merchant.origin]);assert.deepEqual(permission.evidence.approvedOrigins,[merchant.origin]);assert.equal(form.merchants[0].example,undefined);
 assert.throws(()=>setupFromTemplate("protocol-test",1952,1793340000000,{...merchant,recipient:"0x"+"1".repeat(40)}),/not configured/);
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
 assert.equal(budgetProseWarnings({mission:"Buy approved reports",taskContext:"",criteria:[{id:"budget",description:"Apply a daily aggregate spending limit of $250.00 USDC."}]}).length,1);
 assert.equal(budgetProseWarnings({mission:"Buy approved reports",taskContext:"",criteria:[{id:"budget",description:"Maximum 250 USDC per 24 hours."}]}).length,1);
 assert.equal(budgetProseWarnings({mission:"Buy approved reports",taskContext:"",criteria:[{id:"budget",description:"The total amount requested does not exceed $50.00 USDC for a single transaction or $250.00 USDC in daily aggregate spending."}]}).length,1);
 assert.equal(budgetProseWarnings({mission:"Buy approved daily research reports",taskContext:"",criteria:[{id:"invoice",description:"Match the exact invoice amount to the requested amount."}]}).length,0);
 assert.equal(budgetProseWarnings({mission:"Buy approved reports",taskContext:"",criteria:[]}).length,0);
 assert.equal(placeholderRecipient("0x"+"1".repeat(40)),true);assert.equal(placeholderRecipient("0x1234567890123456789012345678901234567890"),false);
 assert.equal(placeholderRecipient(EXAMPLE_RECIPIENT),true);
});
