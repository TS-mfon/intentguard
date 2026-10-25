"use client";
import Link from "next/link";
export default function ErrorPage({error,retry}:{error:Error&{digest?:string};retry:()=>void}) {
 return <main id="main" className="container page"><div className="page-heading"><h1>This page could not load.</h1><p>Your confirmed transactions are recorded independently. Retry to refresh the current view.</p></div><p className="mono muted">PAGE_UNAVAILABLE{error.digest?" · Reference "+error.digest:""}</p><div className="hero-actions"><button className="button button-primary" onClick={retry}>Retry page</button><Link className="text-link" href="/">Return home</Link></div></main>;
}
