import type {CSSProperties} from "react";

export function BrandMark({size=32,className=""}:{size?:number;className?:string}) {
  return <svg className={"brand-mark "+className} width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M8 5h9v12H8V5Zm15 18h9v12h-9V23ZM8 23h9v12H8V23ZM23 5h9v12h-9V5Z" fill="currentColor"/>
    <path d="M5 20h30" stroke="currentColor" strokeWidth="3"/>
    <path d="M20 8v24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5"/>
  </svg>;
}
export function AgentIdentity({seed,size=48}:{seed:string;size?:number}) {
  let hash=2166136261;
  for(const c of seed)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const offset=(Math.abs(hash)%3)*2;
  return <svg width={size} height={size} viewBox="0 0 64 64" className="agent-identity" role="img" aria-label="Agent identity derived from its immutable identifier">
    <rect x="6" y="6" width="52" height="52" rx="12" fill="var(--elevated)" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M20 6V2m24 4V2M2 25h4m52 14h4" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="16" width="36" height="19" rx="8" fill="var(--background)" stroke="currentColor"/>
    <rect x={20+offset/2} y="23" width="5" height="4" rx="1" fill="currentColor"/>
    <rect x={38-offset/2} y="23" width="5" height="4" rx="1" fill="currentColor"/>
    <path d="M17 45h30m-30 4h30" stroke="currentColor" strokeWidth="2"/>
    <path d="M25 41v12m7-12v12m7-12v12" stroke="currentColor" strokeWidth="1"/>
    <rect x="15" y="55" width="7" height="5" rx="2" fill="currentColor"/>
    <rect x="42" y="55" width="7" height="5" rx="2" fill="currentColor"/>
  </svg>;
}
export function CardChip({className=""}:{className?:string}) {
  return <svg className={"card-chip "+className} viewBox="0 0 64 48" aria-hidden="true">
    <rect x="1" y="1" width="62" height="46" rx="8" fill="var(--muted)" stroke="var(--background)" strokeWidth="1.5"/>
    <rect x="21" y="10" width="22" height="28" rx="4" fill="var(--accent)" stroke="var(--background)"/>
    <path d="M1 16h20m-20 16h20m22-16h20M43 32h20M28 1v9m9-9v9M28 38v9m9-9v9M1 24h20m22 0h20" fill="none" stroke="var(--background)" strokeWidth="1.4"/>
  </svg>;
}
