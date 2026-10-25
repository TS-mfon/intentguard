import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
test("MCP stdio integration and safety invariants",{timeout:90000},async()=>{
 const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,["--test","--test-reporter=tap","packages/mcp/test/server.test.mjs"],{cwd:new URL("../",import.meta.url),stdio:["ignore","pipe","pipe"],env});
  let output="";child.stdout.on("data",c=>output+=c.toString());child.stderr.on("data",c=>output+=c.toString());child.once("error",reject);child.once("close",code=>resolve({code,output}));
 });
 assert.equal(result.code,0,result.output);
 assert.match(result.output,/# fail 0/);
});
