import {Suspense} from "react";
import {QueryTransaction} from "../../components/static-route";
export const metadata={title:"Transaction details"};
export default function Page(){return <Suspense fallback={<main id="main" className="container page"><p role="status">Loading the requested transaction…</p></main>}><QueryTransaction/></Suspense>;}
