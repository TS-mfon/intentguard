"use client";
import type {Settlement} from "./client";
import type {Config} from "./client";
import {Field,Notice} from "./primitives";
export function settlementRoutes(config:Config|null,asset:"USDC"|"USDT0"){
 const networks=config?.spendingNetworks||[];
 return asset==="USDT0"?networks.filter(n=>n.chainId===196&&config?.mode==="mainnet"):config?.settlementVersion===1?networks.filter(n=>[1952,84532,421614].includes(n.chainId)):networks;
}
export function selectedSettlement(config:Config,asset:"USDC"|"USDT0",ids:number[],replacement=false):Settlement{
 const permitted=settlementRoutes(config,asset),available=config.assets?.some(a=>a.asset===asset&&a.available&&a.chainId===config.chainId&&!!a.token);
 if(!config.configured||!available||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!permitted.some(n=>n.chainId===id)))throw Error("Select a release-verified asset and at least one permitted spending network.");
 if(config.settlementVersion===1&&!replacement){if(config.mode!=="testnet"||asset!=="USDC")throw Error("Legacy settlement supports testnet USDC only.");return {asset:"USDC",destinationChainIds:[...ids].sort((a,b)=>a-b) as (1952|84532|421614)[]};}
 if(config.settlementVersion!==2||!["mainnet","testnet"].includes(config.mode))throw Error("This deployment does not have a verified versioned replacement factory.");
 if(ids.length>11||(asset==="USDT0"&&(config.mode!=="mainnet"||ids.length!==1||ids[0]!==196)))throw Error("USDT0 permits X Layer mainnet settlement only.");
 return {version:2,paymentEnvironment:config.mode as "mainnet"|"testnet",asset,destinationChainIds:[...ids].sort((a,b)=>a-b)};
}
export function SettlementFields({config,asset,onAsset,destinationChainIds,onChange,error}:{config:Config|null;asset:"USDC"|"USDT0";onAsset:(asset:"USDC"|"USDT0")=>void;destinationChainIds:number[];onChange:(ids:number[])=>void;error?:string}){
 const networks=settlementRoutes(config,asset),assets=config?.assets||[],selected=assets.find(a=>a.asset===asset);
 return <div className="settlement-fields"><Field id="settlement-asset" label={"Deposit asset · "+(config?.networkName||"Network unavailable")} help="One immutable asset per vault. Deposits come directly from the owner wallet."><select id="settlement-asset" value={asset} onChange={e=>{const value=e.target.value as "USDC"|"USDT0";onAsset(value);onChange(settlementRoutes(config,value).some(n=>n.chainId===config?.chainId)?[config!.chainId]:[]);}}>{(["USDC","USDT0"] as const).map(value=>{const entry=assets.find(a=>a.asset===value);return <option key={value} value={value} disabled={!entry?.available}>{value}{entry?.available?" · "+(config?.mode==="mainnet"?"mainnet":"testnet"):" · unavailable until verified"}</option>;})}</select></Field>
 {selected?.token?<p className="field-help">Deposit token: <code className="break">{selected.token}</code> · {selected.decimals} decimals.</p>:<Notice>The selected asset has no verified deployment capability. Submission remains unavailable.</Notice>}
 <fieldset className="form-details" id="destinationChainIds"><legend>Approve spending networks</legend><p className="field-help">{asset==="USDT0"?"USDT0 settles only on X Layer mainnet.":"USDC settles locally or burns through CCTP to the networks you select. The destination subset is immutable."}</p>{networks.map(n=><label className="confirmation-check" key={n.chainId}><input type="checkbox" checked={destinationChainIds.includes(n.chainId)} onChange={e=>onChange(e.target.checked?[...destinationChainIds,n.chainId]:destinationChainIds.filter(id=>id!==n.chainId))}/><span>{n.name}<small className="field-help"> · chain {n.chainId} / CCTP domain {n.domain}</small></span></label>)}{!networks.length?<p role="status">No verified spending routes are enabled.</p>:null}{error?<p className="field-error" role="alert">{error}</p>:null}</fieldset>
 <p className="field-help">{config?.mode==="mainnet"?"Payments use real mainnet assets. Semantic review runs on GenLayer Studionet testnet and relies on the configured attestor.":"Payment and review infrastructure are testnet. Testnet tokens have no monetary value."}</p></div>;
}
