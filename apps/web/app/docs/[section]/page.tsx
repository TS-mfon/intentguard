import {notFound} from "next/navigation";
import {Docs} from "../../../components/docs";
import {docsSections,type DocsSection} from "../sections";
export function generateStaticParams(){return docsSections.map(([,section])=>({section}))}
export async function generateMetadata({params}:{params:Promise<{section:string}>}){const {section}=await params;const item=docsSections.find(([,id])=>id===section);return {title:(item?.[2]??"Documentation")+" | IntentGuard",description:"IntentGuard protocol: "+(item?.[2]??"integration")}}
export default async function Page({params}:{params:Promise<{section:string}>}){const {section}=await params;if(!docsSections.some(([,id])=>id===section))notFound();return <Docs section={section as DocsSection}/>}
