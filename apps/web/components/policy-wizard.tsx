"use client";
import {Suspense} from "react";
import {Modal} from "./primitives";
import {SetupForm} from "./agent-setup";
import type {ActivationDraft,Config} from "./client";

/** Legacy modal entry shares the current owner's setup state and exact validation. */
export function PolicyWizard({open,onOpenChange,onActivate}:{open:boolean;onOpenChange:(open:boolean)=>void;config:Config|null;owner:string|null;offline?:boolean;onActivate:(draft:ActivationDraft,status:(message:string)=>void)=>Promise<void>}){
 return <Modal open={open} onOpenChange={onOpenChange} title="Create an agent" wide>{open?<Suspense fallback={<p role="status">Loading your setup…</p>}><SetupForm initialMode="manual" onActivation={onActivate} onDone={()=>onOpenChange(false)}/></Suspense>:null}</Modal>;
}
