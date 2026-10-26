import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {z} from "zod";
import {address,hash} from "../../../packages/shared";
import {parseStrictJson} from "../../../packages/shared/strict-json";
import {configuration,STUDIONET_CONSENSUS} from "./config";
import {profileRoutes,SOURCE_CHAIN_IDS} from "../../../packages/shared/payment-profiles";
const manifestSchema=z.object({
 version:z.literal(1),paymentEnvironment:z.enum(["mainnet","testnet"]),paymentChainId:z.union([z.literal(196),z.literal(1952)]),
 releaseId:z.string().min(1),sourceCommit:z.string().regex(/^[0-9a-f]{40}$/),
 applicationOrigin:z.string().url(),databaseName:z.string().min(1),
 reviewEnvironment:z.literal("testnet"),reviewNetwork:z.literal("studionet"),
 reviewGenesis:hash,reviewConsensus:address,
 contracts:z.object({factoryAddress:address,cctpFactoryAddress:address,gateway:address,attestor:address,processor:address,beacon:address,expectedImplementation:address,interpreter:address}).strict(),
 circuitId:z.string().regex(/^[1-9][0-9]*$/),netlistHash:hash,
 codeHashes:z.object({factoryAddress:hash,cctpFactoryAddress:hash,processor:hash,beacon:hash,expectedImplementation:hash}).strict(),
 enabledAssets:z.array(z.enum(["USDC","USDT0"])).min(1),
 verifiedDestinationChainIds:z.array(z.number().int().positive()).min(1),
 verifiedAt:z.string().datetime()
}).strict();
export type RuntimeManifest=z.infer<typeof manifestSchema>;
export function validateRuntimeManifest(raw:unknown,cfg:ReturnType<typeof configuration>){
 const m=manifestSchema.parse(raw);
 if(m.paymentChainId!==SOURCE_CHAIN_IDS[m.paymentEnvironment]||new Set(m.enabledAssets).size!==m.enabledAssets.length||new Set(m.verifiedDestinationChainIds).size!==m.verifiedDestinationChainIds.length||!m.verifiedDestinationChainIds.includes(m.paymentChainId)||m.verifiedDestinationChainIds.some(id=>!profileRoutes(m.paymentEnvironment)[id])||(m.paymentEnvironment==="testnet"&&m.enabledAssets.includes("USDT0"))||m.reviewConsensus.toLowerCase()!==STUDIONET_CONSENSUS)throw Error("Verified deployment capability mismatch");
 if(cfg.local||m.paymentEnvironment!==cfg.paymentEnvironment||m.paymentChainId!==cfg.chainId||m.databaseName!==cfg.databaseName||m.releaseId!==cfg.releaseId||m.sourceCommit!==cfg.sourceCommit||m.applicationOrigin!==cfg.origin||m.reviewGenesis.toLowerCase()!==cfg.genLayerGenesis?.toLowerCase()||m.reviewConsensus.toLowerCase()!==cfg.genLayerConsensus?.toLowerCase()||m.circuitId!==cfg.circuitId||m.netlistHash.toLowerCase()!==cfg.expectedNetlistHash?.toLowerCase())throw Error("Verified deployment does not match runtime identity");
 for(const key of ["factoryAddress","gateway","attestor","processor","beacon","expectedImplementation","interpreter"] as const)if(m.contracts[key].toLowerCase()!==cfg[key]?.toLowerCase())throw Error("Verified deployment address mismatch");
 if(m.contracts.cctpFactoryAddress.toLowerCase()!==process.env.CCTP_CARD_FACTORY_ADDRESS?.toLowerCase())throw Error("Verified CCTP factory mismatch");
 return m;
}
export async function runtimeManifest(cfg=configuration()){
 if(cfg.local)throw Error("Hosted verification manifest required");
 if(!cfg.verifiedManifest||!cfg.verifiedManifestSha256)throw Error("Pinned mainnet verification manifest missing");
 const bytes=await readFile(cfg.verifiedManifest);
 if(bytes.length>262144||createHash("sha256").update(bytes).digest("hex")!==cfg.verifiedManifestSha256)throw Error("Mainnet verification manifest hash mismatch");
 return validateRuntimeManifest(parseStrictJson(bytes.toString("utf8")),cfg);
}
