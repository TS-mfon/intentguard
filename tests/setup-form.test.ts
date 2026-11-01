import test from "node:test";
import assert from "node:assert/strict";
import {policySchema,digest} from "../packages/shared";
import {setupFromTemplate,setupFromPolicy} from "../apps/web/components/agent-templates";
import {apiSetupErrors,restoreSetupForm,setupGuidance,updateMerchantOrigin,validateSetup} from "../apps/web/components/setup-form";

const merchant={name:"Approved verification merchant",recipient:"0x1234567890123456789012345678901234567890",origin:"https://merchant.vendor.com",products:["Native USDC settlement verification"]};
const form=()=>setupFromTemplate("protocol-test",1952,1793340000123,merchant);
test("quick and manual forms produce identical canonical owner terms including exact validity seconds",()=>{
 const quick=form(),permission=policySchema.parse(setupGuidance(quick)),manual=setupFromPolicy(permission,quick.asset,quick.destinationChainIds);
 assert.equal(digest(setupGuidance(manual)),digest(permission));assert.deepEqual(validateSetup(manual),{});assert.equal(permission.financial.validFrom,1793340000);
});
test("merchant origin edits synchronize evidence while retaining additional owner-approved sources",()=>{
 const original={...form(),approvedOrigins:merchant.origin+"\nhttps://docs.vendor.com"},changed=updateMerchantOrigin(original,0,"https://new.vendor.com");
 assert.equal(changed.approvedOrigins,"https://docs.vendor.com\nhttps://new.vendor.com");assert.equal(original.merchants[0].origins,merchant.origin);
});
test("form validation reports money dates duplicate merchants and hidden criteria together",()=>{
 const value=form();value.totalBudget="1e3";value.perPaymentLimit="0";value.start="2026-02-30T00:00:00";value.end="";value.merchants.push({...value.merchants[0]});value.criteria.push({...value.criteria[0]});
 const errors=validateSetup(value);for(const field of ["totalBudget","perPaymentLimit","start","end","merchant-0-recipient","criteria"])assert.ok(errors[field]);
 assert.deepEqual(Object.keys(validateSetup(value,0)),[]);assert.ok(validateSetup(value,1).criteria);assert.ok(validateSetup(value,2).totalBudget);
});
test("server field issues reopen the correct owner form inputs and preserve array error compatibility",()=>{
 const issues=[{path:["financial","validUntil"],message:"Expiry must follow start"},{path:["merchants",0,"recipient"],message:"Invalid recipient"},{field:"evidence.approvedOrigins",message:"HTTPS required"}];
 assert.deepEqual(apiSetupErrors({issues}),{end:"Expiry must follow start","merchant-0-recipient":"Invalid recipient",approvedOrigins:"HTTPS required"});assert.deepEqual(apiSetupErrors(issues),apiSetupErrors({issues}));assert.deepEqual(apiSetupErrors({privateDiagnostic:"provider"}),{});
});
test("stored form restores only known fields and never carries arbitrary session credentials",()=>{
 const value=form(),restored=restoreSetupForm({...value,ownerToken:"must-not-persist",apiKey:"must-not-persist",walletSignature:"must-not-persist"});
 assert.deepEqual(restored,value);assert.equal(JSON.stringify(restored).includes("must-not-persist"),false);assert.equal(digest(setupGuidance(restored)),digest(setupGuidance(value)));
 for(const bad of [null,{...value,merchants:[null]},{...value,criteria:[{id:"a",description:1}]},{...value,destinationChainIds:["1952"]},{...value,totalBudget:3}])assert.throws(()=>restoreSetupForm(bad));
});
