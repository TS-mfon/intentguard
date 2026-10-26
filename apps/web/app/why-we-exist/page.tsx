import type {Metadata} from "next";
import {WhyWeExist} from "../../components/why-we-exist";

export const metadata: Metadata = {
  title: "Why we exist",
  description: "Intelligence with permission. Follow an agent’s human-issued ATM card through mandatory TapeOut checks, GenLayer evidence review and exact X Layer testnet settlement.",
  alternates: {canonical: "/why-we-exist"},
  openGraph: {
    title: "Intelligence. With permission. | IntentGuard",
    description: "The human sets the mission. The agent earns permission before payment.",
    url: "/why-we-exist",
    images: [{url: "/motion/protocol-story-poster.jpg", width: 1920, height: 1080, alt: "An IntentGuard agent presents its ATM card at the permission gate"}]
  }
};

export default function Page() {return <WhyWeExist/>}
