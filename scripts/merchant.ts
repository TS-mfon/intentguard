import http from "node:http";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {address,parseAmount,TOKEN} from "../packages/shared";
const recipient=address.parse(process.env.DEMO_MERCHANT_RECIPIENT),base=process.env.DEMO_MERCHANT_URL,admin=process.env.DEMO_MERCHANT_ADMIN_KEY;
if(!base||new URL(base).protocol!=="https:"||!admin||admin.length<24)throw Error("Set public HTTPS merchant URL, recipient and 24-character admin key");
const directory=new URL("../.local/merchant-invoices/",import.meta.url);await mkdir(directory,{recursive:true});
const schema=z.object({buyer:address,amount:z.string().refine(v=>{try{return parseAmount(v)>0n}catch{return false}}),description:z.string().min(3).max(1000)}).strict();
const server=http.createServer(async(req,res)=>{const reply=(status:number,body:unknown)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(body))};try{
 const url=new URL(req.url??"/",base),match=url.pathname.match(/^\/invoices\/([a-f0-9]{32})$/);
 if(req.method==="GET"&&match){const raw=await readFile(new URL(match[1]+".json",directory),"utf8");res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"public, max-age=60"});res.end(raw);return;}
 if(req.method==="GET"&&url.pathname==="/"){reply(200,{service:"IntentGuard demonstration merchant",recipient,chainId:196,token:TOKEN});return;}
 if(req.method!=="POST"||url.pathname!=="/invoices"){reply(404,{error:"Not found"});return}
 const supplied=Buffer.from(req.headers.authorization?.replace(/^Bearer /,"")??""),expected=Buffer.from(admin);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){reply(401,{error:"Merchant administrator key required"});return}
 let raw="";for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>8192)throw Error("Body too large")}
 const input=schema.parse(JSON.parse(raw)),invoiceId=randomBytes(16).toString("hex"),now=Math.floor(Date.now()/1000);
 const invoice={invoiceId,buyer:input.buyer,token:TOKEN,chainId:196,recipient,amount:input.amount,description:input.description,issuedAt:now,expiresAt:now+3600};
 await writeFile(new URL(invoiceId+".json",directory),JSON.stringify(invoice),{flag:"wx",mode:0o600});
 reply(201,{invoice,url:base.replace(/\/$/,"")+"/invoices/"+invoiceId});
 }catch(e){reply(422,{error:e instanceof Error&&"code" in e&&e.code==="ENOENT"?"Invoice not found":"Invalid invoice request"})}});
server.listen(Number(process.env.DEMO_MERCHANT_PORT??3301),"0.0.0.0",()=>console.log("Public invoice reads enabled; invoice creation requires the merchant administrator key"));
