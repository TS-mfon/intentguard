import assert from "node:assert/strict";
import {lstat,readdir,realpath} from "node:fs/promises";
import {resolve,join,extname} from "node:path";
import {hash,digest,regularBytes,PINS} from "./protocol.mjs";
const MIME={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".avif":"image/avif",".svg":"image/svg+xml",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",".wasm":"application/wasm",".mp4":"video/mp4",".webm":"video/webm",".mp3":"audio/mpeg",".ogg":"audio/ogg",".wav":"audio/wav",".txt":"text/plain; charset=utf-8",".xml":"application/xml",".pdf":"application/pdf",".bin":"application/octet-stream"};
const FORBIDDEN=/^(?:\.env(?:\..*)?|\.git|\.next|node_modules|\.local|\.tape|\.well-known|secrets?(?:\..*)?|credentials?(?:\..*)?)(?:$|\/)|(?:\.(?:map|ts|tsx|jsx|pem|key|p12|pfx|keystore|bak|sql|sqlite|log|yml|yaml|toml)$)|(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|Dockerfile)$/i;
export function validatePath(path){
 assert.ok(typeof path==="string"&&path.length>0&&Buffer.byteLength(path)<=1024,"Invalid static path");
 assert.equal(path.normalize("NFC"),path,"Paths must be Unicode NFC");
 assert.ok(!/[\\%?#\u0000-\u001f\u007f]/.test(path),"Ambiguous or unsafe gateway path");
 assert.ok(!path.startsWith("/")&&!path.endsWith("/")&&!path.includes("//"),"Invalid path separator");
 assert.ok(path.split("/").every(p=>p!==""&&p!=="."&&p!==".."&&!p.startsWith(".")),"Hidden/traversal paths are forbidden");
 assert.ok(!FORBIDDEN.test(path)&&!path.split("/").some(p=>FORBIDDEN.test(p)),"Forbidden source or secret path");
 assert.ok(MIME[extname(path).toLowerCase()],"Unsupported static MIME type");
 return path;
}
export function checkContent(bytes,path){
 const ext=extname(path).toLowerCase();
 if([".html",".js",".mjs",".css",".json",".svg",".txt",".xml"].includes(ext)){
  const text=bytes.toString("utf8");
  assert.ok(!/(?:sourceMappingURL\s*=|data:application\/json[^\s]*;base64,)/i.test(text),"Source maps are forbidden");
  assert.ok(!/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|mongodb(?:\+srv)?:\/\/[^\s"']+:[^\s"']+@|\b(?:ghp_|github_pat_|sk-proj-)[a-zA-Z0-9_\-]{20,}/.test(text),"Credential detected in static content");
  assert.ok(!/(?:private[_-]?key|session[_-]?secret|api[_-]?secret|operator[_-]?key|password)\s*["']?\s*[:=]\s*["'][^"']{16,}["']/i.test(text),"Secret literal detected in static content");
 }
}
export function gatewayResolve(raw,paths,fallback="index.html"){
 let p;try{p=decodeURIComponent(String(raw).split(/[?#]/)[0]);}catch{return null;}
 p=p.normalize("NFC").replace(/\/+/g,"/");if(/[\u0000-\u001f\u007f]/.test(p)||p.split("/").some(x=>x==="."||x===".."))return null;
 if(!p||p==="/"||p.endsWith("/"))p=p.replace(/\/?$/,"/")+"index.html";
 p=p.replace(/^\/+/, "");if(paths.has(p))return p;
 if(!/\.[^/]+$/.test(p.split("/").at(-1))){if(paths.has(p+"/index.html"))return p+"/index.html";if(paths.has(fallback))return fallback;}
 return null;
}
export async function scanBundle(directory,{fallback="index.html",apiOrigins=[]}={}){
 directory=resolve(directory);assert.equal(await realpath(directory),directory,"Static root must not resolve through symlinks");
 assert.ok((await lstat(directory)).isDirectory(),"Static directory required");
 const files=[];const external=new Set();
 for(const origin of apiOrigins){const u=new URL(origin);assert.equal(u.protocol,"https:");assert.equal(u.origin,origin,"API origins must be canonical HTTPS origins");}
 async function walk(relative=""){
  const entries=(await readdir(join(directory,relative),{withFileTypes:true})).sort((a,b)=>Buffer.compare(Buffer.from(a.name),Buffer.from(b.name)));
  for(const entry of entries){
   const path=relative?relative+"/"+entry.name:entry.name;
   assert.equal(path.normalize("NFC"),path,"Paths must be Unicode NFC");
   const full=join(directory,path),st=await lstat(full);assert.ok(!st.isSymbolicLink(),"Symlinks are forbidden");
   if(st.isDirectory()){
    assert.ok(!entry.name.startsWith(".")&&!FORBIDDEN.test(entry.name),"Forbidden directory");await walk(path);
   }else{
    validatePath(path);assert.ok(st.isFile(),"Special files are forbidden");
    assert.ok(st.size<=PINS.limits.chunkBytes*PINS.limits.maxChunks,"File exceeds 350 chunks");
    const bytes=await regularBytes(full);checkContent(bytes,path);
    const chunks=[];for(let offset=0;offset<bytes.length||offset===0;offset+=PINS.limits.chunkBytes){
     const b=bytes.subarray(offset,offset+PINS.limits.chunkBytes);chunks.push({index:chunks.length,offset,size:b.length,sha256:hash(b)});
    }
    assert.ok(chunks.length<=350,"File exceeds 350 chunks");
    files.push({path,size:bytes.length,sha256:hash(bytes),contentType:MIME[extname(path).toLowerCase()],chunks});
    if([".html",".css",".js",".mjs"].includes(extname(path).toLowerCase())){
     for(const match of bytes.toString("utf8").matchAll(/https?:\/\/[^\s"'<>\\)]+/g)){try{external.add(new URL(match[0]).origin);}catch{/* Invalid references are checked in browser acceptance. */}}
    }
   }
  }
 }
 await walk();assert.ok(files.length>0&&files.length<=PINS.limits.maxPaths,"Manifest path limit exceeded");
 const paths=new Set(files.map(f=>f.path));assert.equal(paths.size,files.length,"Duplicate paths");
 assert.ok(paths.has("index.html"),"Static export requires root index.html");validatePath(fallback);assert.ok(paths.has(fallback),"Fallback file is missing");
 const manifest={version:1,files,fallback,apiOrigins:[...new Set(apiOrigins)].sort(),externalOrigins:[...external].sort(),totalBytes:files.reduce((sum,f)=>sum+f.size,0),totalChunks:files.reduce((sum,f)=>sum+f.chunks.length,0)};
 return {...manifest,directorySha256:digest(manifest)};
}
