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
import {StaticRoute} from "../components/static-route";
export const metadata:Metadata={metadataBase:new URL("https://intentguard-tapeout.vercel.app"),alternates:{canonical:"/"},openGraph:{title:"IntentGuard · Agent ATM Cards",description:"Owner-issued spending permission. TapeOut numerical gates. GenLayer evidence review.",type:"website",url:"https://intentguard-tapeout.vercel.app"},title:{default:"IntentGuard · Agent ATM Cards",template:"%s · IntentGuard"},description:"Give agents bounded spending authority on X Layer. GenLayer semantic review runs on Studionet testnet."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><RuntimeProvider><StaticRoute>{children}</StaticRoute></RuntimeProvider></body></html>}
