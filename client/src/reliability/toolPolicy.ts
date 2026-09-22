import { normalizeTechnicalId } from './entities.js';
import type { WorkflowKind } from './types.js';

/** v0.10.0: reads consume command-owned typed slots; accumulated transcript is never reparsed here. */
export type ToolClass='CONTEXT_READ'|'ENTITY_READ'|'AUTHORITATIVE_READ'|'MUTATION';
export const TOOL_CLASSES:Readonly<Record<string,ToolClass>>=Object.freeze({get_current_job:'CONTEXT_READ',check_component:'ENTITY_READ',check_inventory:'ENTITY_READ',find_alternative_inventory:'ENTITY_READ',inspect_last_action:'AUTHORITATIVE_READ',report_exception:'MUTATION',update_job_status:'MUTATION',report_inventory_discrepancy:'MUTATION',reverse_last_scan:'MUTATION'});
export const toolClass=(name:string):ToolClass|null=>TOOL_CLASSES[name]??null;
export const isReadOnlyTool=(name:string)=>{const k=toolClass(name);return k==='CONTEXT_READ'||k==='ENTITY_READ'||k==='AUTHORITATIVE_READ';};
export const isMutationToolName=(name:string)=>toolClass(name)==='MUTATION';
export type ReadReadinessCode='UNKNOWN_TOOL'|'ENTITY_CONFIRMATION_REQUIRED'|'CRITICAL_ENTITY_REQUIRED'|'ENTITY_ARGUMENT_MISMATCH'|'COMMAND_INCOMPLETE';
export type ReadReadinessDecision={ok:true;toolClass:ToolClass}|{ok:false;toolClass:ToolClass|null;code:ReadReadinessCode;message:string;detail?:string};
export type ReadReadinessInput={toolName:string;args:Record<string,unknown>;commandReady:boolean;workflow?:WorkflowKind|null;trustedComponent?:string|null;pendingEntityConfirmation?:string|null};
export function assessReadReadiness(input:ReadReadinessInput):ReadReadinessDecision{
 const kind=toolClass(input.toolName);if(!kind||kind==='MUTATION')return{ok:false,toolClass:kind,code:'UNKNOWN_TOOL',message:'This tool is not a classified read-only operational tool.'};
 if(input.pendingEntityConfirmation&&kind!=='CONTEXT_READ')return{ok:false,toolClass:kind,code:'ENTITY_CONFIRMATION_REQUIRED',message:`The reconstructed component ${input.pendingEntityConfirmation} is awaiting explicit worker confirmation on this same command. Ask the worker to repeat the complete component identifier. No operational tool has failed or been called.`,detail:input.pendingEntityConfirmation};
 if(kind==='CONTEXT_READ')return{ok:true,toolClass:kind};
 if(kind==='AUTHORITATIVE_READ'){if(!input.commandReady)return{ok:false,toolClass:kind,code:'COMMAND_INCOMPLETE',message:'The worker command is not yet complete enough to inspect authoritative recovery state. Ask only for the missing worker-provided critical information. No operational tool has failed or been called.'};return{ok:true,toolClass:kind};}
 const arg=normalizeTechnicalId(input.args.component_id,'component_id');if(!arg)return{ok:false,toolClass:kind,code:'CRITICAL_ENTITY_REQUIRED',message:'A complete, unambiguous component identifier is required before this read. Ask the worker for the component identifier; never guess it. No operational tool has failed or been called.'};
 const trusted=normalizeTechnicalId(input.trustedComponent,'component_id');if(!trusted)return{ok:false,toolClass:kind,code:'CRITICAL_ENTITY_REQUIRED',message:'This command does not yet own a trusted component slot for the requested read. Ask only for the missing field or perform the prerequisite authoritative read. No operational tool has failed or been called.',detail:input.workflow??undefined};
 if(arg!==trusted)return{ok:false,toolClass:kind,code:'ENTITY_ARGUMENT_MISMATCH',message:'The component in this tool call does not match the trusted typed component owned by the active command. No operational tool has failed or been called.',detail:`Command slot ${trusted}; tool requested ${arg}.`};
 return{ok:true,toolClass:kind};
}
