import {test} from "node:test";
import assert from "node:assert/strict";
import {parseStrictJson} from "../packages/shared/strict-json";
test("strict JSON accepts legitimate repeated keys in different objects",()=>{const value={a:[{key:1},{key:2}],text:'a "key":3',number:-12.5e4,flag:true};assert.deepEqual(parseStrictJson(JSON.stringify(value)),value);});
test("strict JSON rejects conflicting and escaped duplicate keys",()=>{for(const text of ['{"processor":"old","processor":"new"}','{"nested":[{"token":"old","token":"new"}]}','{"a":1,"\\u0061":2}'])assert.throws(()=>parseStrictJson(text),/Duplicate JSON key/);});
test("strict JSON rejects syntax errors trailing contents and excessive nesting",()=>{for(const text of ['{"a":1,}','[1,]','{"a":00}','null true','"bad\\q"'])assert.throws(()=>parseStrictJson(text));assert.throws(()=>parseStrictJson("[".repeat(66)+"0"+"]".repeat(66)),/nesting/);});
