"use client";
import {useEffect,useState,type ReactNode} from "react";
import {useSearchParams} from "next/navigation";
import {TransactionPage} from "./public";
import {staticFrontend} from "./client";
export function QueryTransaction(){const params=useSearchParams(),id=params.get("id")||"";return /^0x[a-fA-F0-9]{64}$/.test(id)?<TransactionPage id={id}/>:<main id="main" className="container page"><h1>Transaction not found</h1><p>Open a transaction from the public explorer to inspect its commitments and receipts.</p><a className="text-link" href="/explorer">Open explorer</a></main>;}
export function StaticRoute({children}:{children:ReactNode}){
 const[id,setId]=useState<string|null>(null);
 useEffect(()=>{if(!staticFrontend)return;const match=window.location.pathname.match(/^\/explorer\/transactions\/(0x[a-fA-F0-9]{64})\/?$/);setId(match?.[1]||null);},[]);
 return id?<TransactionPage id={id}/>:children;
}
