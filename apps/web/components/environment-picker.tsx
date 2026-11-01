"use client";
import {usePathname} from "next/navigation";
import {clearOwnerSession} from "./client";
import {useRuntime} from "./runtime";
import styles from "./onboarding.module.css";

export function EnvironmentPicker(){
 const {config}=useRuntime(),path=usePathname();
 if(!config||!['/agents','/agent-setup','/sandbox'].includes(path))return null;
 const links=config.environmentUrls||{};
 return <nav className={"container "+styles.environments} aria-label="Payment environment"><span>Payment environment</span>{(['testnet','mainnet'] as const).map(environment=>{const current=config.mode===environment,url=links[environment],label=environment==='testnet'?'Testnet · practice':'Mainnet · real funds';return current?<span key={environment} className={styles.currentEnvironment} aria-current="true">{label}</span>:url?<a key={environment} href={url+(['/agents','/agent-setup'].includes(path)?path:'')} onClick={()=>clearOwnerSession()}>{label}</a>:<span key={environment} aria-disabled="true" title="This deployment has not been published yet">{label}<small>Unavailable</small></span>;})}</nav>;
}
