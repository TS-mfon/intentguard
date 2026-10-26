import {test} from "node:test";
import assert from "node:assert/strict";
import {assertSecuritySuite,requiredAttacks} from "../tools/production/verify-security.mjs";
const successful=[...requiredAttacks.map(name=>"✔ "+name+" (1ms)"),"ℹ tests 152","ℹ pass 152","ℹ fail 0","ℹ cancelled 0","ℹ skipped 0","ℹ todo 0"].join("\n");
test("security oracle accepts complete passing attack/control evidence",()=>{assert.equal(assertSecuritySuite("application",successful),152);});
test("security oracle fails skipped, missing, cancelled, todo and reduced tests",()=>{
 for(const bad of [successful.replace("ℹ skipped 0","ℹ skipped 1"),successful.replace("ℹ cancelled 0","ℹ cancelled 1"),successful.replace("ℹ todo 0","ℹ todo 1"),successful.replace("ℹ tests 152","ℹ tests 151"),successful.split("\n").slice(1).join("\n")])assert.throws(()=>assertSecuritySuite("application",bad));
});
