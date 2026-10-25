import {copyFile,mkdir} from "node:fs/promises";
await mkdir(new URL("../resources/",import.meta.url),{recursive:true});
await copyFile(new URL("../../../docs/PROTOCOL.md",import.meta.url),new URL("../resources/PROTOCOL.md",import.meta.url));
await copyFile(new URL("../../../docs/openapi.json",import.meta.url),new URL("../resources/openapi.json",import.meta.url));
await mkdir(new URL("../../../skills/intentguard/references/",import.meta.url),{recursive:true});
await copyFile(new URL("../../../docs/PROTOCOL.md",import.meta.url),new URL("../../../skills/intentguard/references/PROTOCOL.md",import.meta.url));
console.log("MCP and skill protocol resources synchronized");
