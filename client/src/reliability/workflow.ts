import { normalizeTechnicalId } from './entities.js';

/** VoiceStrike v0.10.0 — authoritative workflow evidence is scoped to commandId. */
export type WorkflowPhase = 'IDLE' | 'MISMATCH_CONFIRMED' | 'EXCEPTION_VERIFIED' | 'JOB_BLOCKED_VERIFIED' | 'INVENTORY_CHECKED' | 'DISCREPANCY_VERIFIED';
export type WorkflowPreconditionCode = 'PRECONDITION_REQUIRED';
export type WorkflowDecision = { ok: true } | { ok: false; code: WorkflowPreconditionCode; missing: string; message: string };

type MismatchFact={jobId:string;observed:string;expected:string;at:number};
type ExceptionFact={jobId:string;observed:string;at:number};
type BlockedFact={jobId:string;at:number};
type InventoryFact={component:string;location:string;quantity:number;at:number};
type CommandFacts={mismatch:MismatchFact|null;exceptionVerified:ExceptionFact|null;jobBlockedVerified:BlockedFact|null;inventoryChecks:InventoryFact[];discrepancyVerified:InventoryFact|null};
const FACT_TTL_MS=120_000; const LEGACY_COMMAND='__LEGACY_TEST_COMMAND__';
const fresh=(at:number,now:number)=>at<=now&&now-at<=FACT_TTL_MS;
const emptyFacts=():CommandFacts=>({mismatch:null,exceptionVerified:null,jobBlockedVerified:null,inventoryChecks:[],discrepancyVerified:null});

export class WorkflowPolicy {
  private readonly facts=new Map<string,CommandFacts>();
  reset():void{this.facts.clear();}
  private for(commandId:string):CommandFacts{let v=this.facts.get(commandId);if(!v){v=emptyFacts();this.facts.set(commandId,v);}return v;}
  phase(commandIdOrNow:string|number=LEGACY_COMMAND,now=Date.now()):WorkflowPhase{const commandId=typeof commandIdOrNow==='string'?commandIdOrNow:LEGACY_COMMAND;const effectiveNow=typeof commandIdOrNow==='number'?commandIdOrNow:now;const f=this.facts.get(commandId);if(!f)return'IDLE';if(f.jobBlockedVerified&&fresh(f.jobBlockedVerified.at,effectiveNow))return'JOB_BLOCKED_VERIFIED';if(f.discrepancyVerified&&fresh(f.discrepancyVerified.at,effectiveNow))return'DISCREPANCY_VERIFIED';if(f.exceptionVerified&&fresh(f.exceptionVerified.at,effectiveNow))return'EXCEPTION_VERIFIED';if(f.mismatch&&fresh(f.mismatch.at,effectiveNow))return'MISMATCH_CONFIRMED';if(f.inventoryChecks.some(x=>fresh(x.at,effectiveNow)))return'INVENTORY_CHECKED';return'IDLE';}

  noteComponentCheck(commandId:string,result:{jobId?:unknown;observed?:unknown;expected?:unknown;verdict?:unknown},now?:number):void;
  noteComponentCheck(result:{jobId?:unknown;observed?:unknown;expected?:unknown;verdict?:unknown},now?:number):void;
  noteComponentCheck(a:string|Record<string,unknown>,b?:Record<string,unknown>|number,c=Date.now()):void{const id=typeof a==='string'?a:LEGACY_COMMAND;const r=(typeof a==='string'?b:a) as Record<string,unknown>;const now=typeof a==='string'?c:typeof b==='number'?b:Date.now();const observed=normalizeTechnicalId(r?.observed,'component_id');const expected=normalizeTechnicalId(r?.expected,'component_id');const jobId=String(r?.jobId??'').trim();if(String(r?.verdict??'').toUpperCase()==='MISMATCH'&&observed&&expected&&jobId)this.for(id).mismatch={jobId,observed,expected,at:now};}

  noteInventoryCheck(commandId:string,result:{component?:unknown;location?:unknown;quantity?:unknown},now?:number):void;
  noteInventoryCheck(result:{component?:unknown;location?:unknown;quantity?:unknown},now?:number):void;
  noteInventoryCheck(a:string|Record<string,unknown>,b?:Record<string,unknown>|number,c=Date.now()):void{const id=typeof a==='string'?a:LEGACY_COMMAND;const r=(typeof a==='string'?b:a) as Record<string,unknown>;const now=typeof a==='string'?c:typeof b==='number'?b:Date.now();const component=normalizeTechnicalId(r?.component,'component_id');const location=normalizeTechnicalId(r?.location,'location_id');const quantity=Number(r?.quantity??0);if(!component||!location||!Number.isFinite(quantity)||quantity<=0)return;const f=this.for(id);f.inventoryChecks=[...f.inventoryChecks.filter(x=>x.component!==component||x.location!==location),{component,location,quantity,at:now}];}

  noteExceptionVerified(commandId:string,input:{jobId?:unknown;observed?:unknown},now?:number):void;
  noteExceptionVerified(input:{jobId?:unknown;observed?:unknown},now?:number):void;
  noteExceptionVerified(a:string|Record<string,unknown>,b?:Record<string,unknown>|number,c=Date.now()):void{const id=typeof a==='string'?a:LEGACY_COMMAND;const r=(typeof a==='string'?b:a) as Record<string,unknown>;const now=typeof a==='string'?c:typeof b==='number'?b:Date.now();const f=this.for(id);const jobId=String(r?.jobId??'').trim()||f.mismatch?.jobId||'';const observed=normalizeTechnicalId(r?.observed,'component_id')??f.mismatch?.observed??'';if(jobId&&observed)f.exceptionVerified={jobId,observed,at:now};}

  noteJobBlockedVerified(commandId:string,input:{jobId?:unknown},now?:number):void;
  noteJobBlockedVerified(input:{jobId?:unknown},now?:number):void;
  noteJobBlockedVerified(a:string|Record<string,unknown>,b?:Record<string,unknown>|number,c=Date.now()):void{const id=typeof a==='string'?a:LEGACY_COMMAND;const r=(typeof a==='string'?b:a) as Record<string,unknown>;const now=typeof a==='string'?c:typeof b==='number'?b:Date.now();const f=this.for(id);const jobId=String(r?.jobId??'').trim()||f.exceptionVerified?.jobId||'';if(jobId)f.jobBlockedVerified={jobId,at:now};}

  noteDiscrepancyVerified(commandId:string,input:{component?:unknown;location?:unknown},now?:number):void;
  noteDiscrepancyVerified(input:{component?:unknown;location?:unknown},now?:number):void;
  noteDiscrepancyVerified(a:string|Record<string,unknown>,b?:Record<string,unknown>|number,c=Date.now()):void{const id=typeof a==='string'?a:LEGACY_COMMAND;const r=(typeof a==='string'?b:a) as Record<string,unknown>;const now=typeof a==='string'?c:typeof b==='number'?b:Date.now();const component=normalizeTechnicalId(r?.component,'component_id');const location=normalizeTechnicalId(r?.location,'location_id');if(component&&location)this.for(id).discrepancyVerified={component,location,quantity:0,at:now};}

  hasVerifiedException(commandId:string=LEGACY_COMMAND,now=Date.now()):boolean{const f=this.facts.get(commandId);return Boolean(f?.exceptionVerified&&fresh(f.exceptionVerified.at,now));}
  hasVerifiedBlock(commandId:string=LEGACY_COMMAND,now=Date.now()):boolean{const f=this.facts.get(commandId);return Boolean(f?.jobBlockedVerified&&fresh(f.jobBlockedVerified.at,now));}

  assess(commandId:string,toolName:string,args:Record<string,unknown>,now?:number):WorkflowDecision;
  assess(toolName:string,args:Record<string,unknown>,now?:number):WorkflowDecision;
  assess(a:string,b:string|Record<string,unknown>,c?:Record<string,unknown>|number,d=Date.now()):WorkflowDecision{
    const runtime=typeof b==='string';const id=runtime?a:LEGACY_COMMAND;const tool=runtime?b:a;const args=(runtime?c:b) as Record<string,unknown>;const now=runtime?d:typeof c==='number'?c:Date.now();const f=this.for(id);
    if(tool==='report_exception'){const observed=normalizeTechnicalId(args.observed_component,'component_id');if(!f.mismatch||!fresh(f.mismatch.at,now))return{ok:false,code:'PRECONDITION_REQUIRED',missing:'check_component MISMATCH on this command',message:'No authoritative component mismatch has been established for this command. Call check_component with the command-owned observed component first. No exception was created and no operational tool was called.'};if(observed&&observed!==f.mismatch.observed)return{ok:false,code:'PRECONDITION_REQUIRED',missing:`check_component MISMATCH for ${observed} on this command`,message:`The mismatch owned by this command is for ${f.mismatch.observed}, not ${observed}. No exception was created and no operational tool was called.`};return{ok:true};}
    if(tool==='update_job_status'){if(String(args.status??'').toUpperCase()!=='BLOCKED')return{ok:true};if(!this.hasVerifiedException(id,now))return{ok:false,code:'PRECONDITION_REQUIRED',missing:'verified report_exception(WRONG_COMPONENT) on this command',message:'The job cannot be blocked yet: this command does not own an independently verified WRONG_COMPONENT exception. No job status was changed and no operational tool was called.'};return{ok:true};}
    if(tool==='report_inventory_discrepancy'){const component=normalizeTechnicalId(args.component_id,'component_id');const location=normalizeTechnicalId(args.location,'location_id');const match=f.inventoryChecks.find(x=>x.component===component&&x.location===location&&fresh(x.at,now));if(!component||!location||!match)return{ok:false,code:'PRECONDITION_REQUIRED',missing:'positive check_inventory for the same component/location on this command',message:'This command does not own a recent positive authoritative stock record for that exact component and location. Refresh check_inventory under the same discrepancy command. No discrepancy was recorded and no operational tool was called.'};return{ok:true};}
    return{ok:true};
  }
}
