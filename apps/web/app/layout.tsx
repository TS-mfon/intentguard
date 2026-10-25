import type {Metadata} from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import {RuntimeProvider} from "../components/runtime";
export const metadata:Metadata={metadataBase:new URL("https://intentguard-tapeout.vercel.app"),alternates:{canonical:"/"},openGraph:{title:"IntentGuard · Agent ATM Cards",description:"Owner-issued spending permission. TapeOut numerical gates. GenLayer evidence review.",type:"website",url:"https://intentguard-tapeout.vercel.app"},title:{default:"IntentGuard · Agent ATM Cards",template:"%s · IntentGuard"},description:"Give agents spending permission while retaining owner control. Immutable budgets and finalized evidence review on testnet."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><RuntimeProvider>{children}</RuntimeProvider></body></html>}
