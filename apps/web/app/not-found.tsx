import Link from "next/link";
export default function NotFound() {return <main id="main" className="container page"><div className="page-heading"><span className="utility">404 / NOT_FOUND</span><h1>That record is not here.</h1><p>The link may be incomplete or the page may have moved.</p></div><Link className="button button-primary" href="/explorer">Open explorer</Link></main>}
