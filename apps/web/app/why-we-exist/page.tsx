import type {Metadata} from "next";
import {WhyWeExist} from "../../components/why-we-exist";
export const metadata:Metadata={
  title:"Why we exist",
  description:"From an agent’s instruction to a permitted payment. Follow IntentGuard’s owner mandate, TapeOut circuit and GenLayer evidence review on X Layer testnet.",
  alternates:{canonical:"/why-we-exist"},
  openGraph:{title:"Why IntentGuard exists",description:"An agent can act. Its card must earn permission.",url:"/why-we-exist",images:[{url:"/motion/protocol-story-poster.jpg",width:1920,height:1080,alt:"IntentGuard agent and ATM card at the payment gate"}]}
};
export default function Page(){return <WhyWeExist/>}
