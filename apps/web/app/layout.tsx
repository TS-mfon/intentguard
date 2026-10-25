import type {Metadata} from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import {RuntimeProvider} from "../components/runtime";
export const metadata:Metadata={title:{default:"IntentGuard — Permission for agent spending",template:"%s · IntentGuard"},description:"Give agents spending permission while retaining owner control. Immutable budgets and finalized evidence review on testnet."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><RuntimeProvider>{children}</RuntimeProvider></body></html>}
