/** Reject duplicate object keys before JSON.parse can silently discard evidence.
 * Keys are compared after escape decoding, including nested objects in arrays.
 */
export function parseStrictJson(text:string):unknown{
 if(text.length>1048576)throw Error("JSON document exceeds1MiB");
 let at=0;
 const space=()=>{while(/[\t\n\r ]/.test(text[at]??"x"))at++;};
 function string(){
  const start=at;if(text[at++]!=='"')throw Error("JSON string expected");
  while(at<text.length){const ch=text[at++];if(ch==='"')return JSON.parse(text.slice(start,at)) as string;if(ch==="\\")at++;}
  throw Error("Unterminated JSON string");
 }
 function value(depth:number):void{
  if(depth>64)throw Error("JSON nesting exceeds64 levels");
  space();const ch=text[at];
  if(ch==="{"){
   at++;space();const keys=new Set<string>();if(text[at]==="}"){at++;return;}
   while(true){space();const key=string();if(keys.has(key))throw Error("Duplicate JSON key");keys.add(key);space();if(text[at++]!==":")throw Error("JSON colon expected");value(depth+1);space();const next=text[at++];if(next==="}")return;if(next!==",")throw Error("JSON object separator expected");}
  }
  if(ch==="["){
   at++;space();if(text[at]==="]"){at++;return;}
   while(true){value(depth+1);space();const next=text[at++];if(next==="]")return;if(next!==",")throw Error("JSON array separator expected");}
  }
  if(ch==='"'){string();return;}
  const token=text.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
  if(!token)throw Error("Invalid JSON value");at+=token[0].length;
 }
 value(0);space();if(at!==text.length)throw Error("Trailing JSON content");
 return JSON.parse(text);
}
