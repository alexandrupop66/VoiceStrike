import type {
  CommandRegistryEvent,
  CriticalEntityResolution,
  PendingCommand,
  WorkflowKind,
} from './types.js';
import { extractTechnicalIds, normalizeTechnicalId, resolveCorrectedTechnicalEntity } from './entities.js';
import { resolveInventoryDiscrepancyEntities } from './inventoryEntities.js';
import {
  containsAnyTechnicalId,
  detectOperationalIntent,
  isExplicitCancellation,
  isCorrectionUtterance,
  isIncompleteTechnicalFragment,
  isOperationalContinuation,
  isWakeQualifiedShortResponse,
  normalizedPhrase,
  type OperationalIntent,
} from './transcript.js';

function makeCommandId(sequence: number): string {
  return `CMD-${Date.now()}-${sequence}`;
}

function commandContext(command: PendingCommand): string {
  return command.fragments.join(' ').replace(/\s+/g, ' ').trim();
}

function isResolved(entity: CriticalEntityResolution): boolean {
  return entity.status === 'RESOLVED' || entity.status === 'CORRECTED';
}

function resolvedComponent(text: string): CriticalEntityResolution {
  return resolveCorrectedTechnicalEntity('component_id', text);
}

function canonical(entity: CriticalEntityResolution): string | undefined {
  return isResolved(entity) ? entity.canonicalValue : undefined;
}

function isUsable(command: PendingCommand | null): command is PendingCommand {
  return Boolean(command && !['INVALIDATED', 'CANCELLED', 'FAILED', 'COMPLETE'].includes(command.status));
}

function workflowFromText(text: string, intent = detectOperationalIntent(text)): WorkflowKind {
  const normalized = normalizedPhrase(text);
  if (!normalized) return 'UNKNOWN';

  if (/\b(?:what(?:'s| is)?|show|tell)\b.*\bcurrent\s+job\b|\bcurrent\s+job\b/i.test(normalized)) return 'READ_JOB';
  if (intent === 'MISSING_INVENTORY') return 'E2_MISSING_INVENTORY';
  if (intent === 'WRONG_COMPONENT') return 'E1_WRONG_COMPONENT';
  if (intent === 'MISTAKEN_SCAN' || intent === 'REVERSE_SCAN' || intent === 'SCAN_CONTEXT') return 'E3_MISTAKEN_SCAN';

  const components = extractTechnicalIds(text, 'component_id');
  if (components.length >= 2 && /\b(?:got|have|having|holding|here|report|reporting|component|part)\b/i.test(normalized)) {
    return 'E1_WRONG_COMPONENT';
  }
  if (components.length >= 1 && /\b(?:where|find|locate|location|stock|inventory|available)\b/i.test(normalized) && !/\b(?:empty|missing|unavailable|out of stock|no stock)\b/i.test(normalized)) {
    return 'INVENTORY_LOOKUP';
  }
  return 'UNKNOWN';
}

function intentForWorkflow(workflow: WorkflowKind, text: string): OperationalIntent | string | undefined {
  const detected = detectOperationalIntent(text);
  if (detected) return detected;
  if (workflow === 'E1_WRONG_COMPONENT') return 'WRONG_COMPONENT';
  if (workflow === 'E2_MISSING_INVENTORY') return 'MISSING_INVENTORY';
  if (workflow === 'E3_MISTAKEN_SCAN') return 'SCAN_CONTEXT';
  if (workflow === 'READ_JOB') return 'READ_JOB';
  if (workflow === 'INVENTORY_LOOKUP') return 'INVENTORY_LOOKUP';
  if (workflow === 'CANCEL_ACTION') return 'CANCEL_ACTION';
  return undefined;
}

function blankCommand(id: string, text: string, now: number, workflow: WorkflowKind): PendingCommand {
  return {
    id,
    intent: intentForWorkflow(workflow, text),
    workflow,
    phase: 'INTERPRET',
    slots: {},
    evidence: {},
    entities: [],
    status: 'COLLECTING',
    fragments: text ? [text] : [],
    createdAt: now,
    updatedAt: now,
  };
}

function refreshEntities(command: PendingCommand): void {
  const entities: CriticalEntityResolution[] = [];
  const source: CriticalEntityResolution['source'] = command.fragments.length > 1 ? 'CLARIFICATION' : 'CURRENT_UTTERANCE';
  const push = (kind: 'component_id' | 'location_id', value?: string) => {
    if (!value) return;
    entities.push({ kind, rawValues: [value], canonicalValue: value, status: 'RESOLVED', source, candidates: [value] });
  };
  if (command.workflow === 'E1_WRONG_COMPONENT') push('component_id', command.slots.observedComponent);
  else if (command.workflow === 'E2_MISSING_INVENTORY') { push('component_id', command.slots.component); push('location_id', command.slots.reportedLocation); }
  else if (command.workflow === 'INVENTORY_LOOKUP' || command.workflow === 'E3_MISTAKEN_SCAN') push('component_id', command.slots.component);
  command.entities = entities;
}

function applyTypedText(command: PendingCommand, text: string): void {
  const detected = detectOperationalIntent(text);
  if (detected) command.intent = detected;

  if (command.workflow === 'READ_JOB') {
    command.phase = 'VERIFY'; command.pendingClarification = undefined; command.status = 'READY'; refreshEntities(command); return;
  }
  if (command.workflow === 'INVENTORY_LOOKUP') {
    const component = canonical(resolvedComponent(text));
    if (component) command.slots.component = component;
    command.pendingClarification = command.slots.component ? undefined : { workflow: command.workflow, field: 'component', allowedType: 'component_id' };
    command.phase = command.pendingClarification ? 'CLARIFY' : 'VERIFY'; command.status = command.pendingClarification ? 'COLLECTING' : 'READY'; refreshEntities(command); return;
  }
  if (command.workflow === 'E1_WRONG_COMPONENT') {
    const component = resolvedComponent(text);
    if (isResolved(component) && component.canonicalValue) command.slots.observedComponent = component.canonicalValue;
    else if (component.status === 'AMBIGUOUS') command.entities = [component];
    command.pendingClarification = command.slots.observedComponent ? undefined : { workflow: command.workflow, field: 'observedComponent', allowedType: 'component_id' };
    command.phase = command.pendingClarification ? 'CLARIFY' : 'VERIFY'; command.status = command.pendingClarification ? 'COLLECTING' : 'READY';
    if (!command.pendingClarification) refreshEntities(command); return;
  }
  if (command.workflow === 'E2_MISSING_INVENTORY') {
    const typed = resolveInventoryDiscrepancyEntities(text);
    const component = canonical(typed.component); const location = canonical(typed.location);
    if (component) command.slots.component = component;
    if (location) command.slots.reportedLocation = location;
    if (typed.observedEmpty) command.slots.observedEmpty = true;
    if (!command.slots.component) command.pendingClarification = { workflow: command.workflow, field: 'component', allowedType: 'component_id' };
    else if (!command.slots.reportedLocation) command.pendingClarification = { workflow: command.workflow, field: 'reportedLocation', allowedType: 'location_id' };
    else if (command.slots.observedEmpty !== true) command.pendingClarification = { workflow: command.workflow, field: 'observedEmpty', allowedType: 'boolean' };
    else command.pendingClarification = undefined;
    command.phase = command.pendingClarification ? 'CLARIFY' : 'VERIFY'; command.status = command.pendingClarification ? 'COLLECTING' : 'READY'; refreshEntities(command); return;
  }
  if (command.workflow === 'E3_MISTAKEN_SCAN') {
    const component = resolvedComponent(text);
    if (isResolved(component) && component.canonicalValue) command.slots.component = component.canonicalValue;
    command.pendingClarification = command.slots.component ? undefined : { workflow: command.workflow, field: 'component', allowedType: 'component_id' };
    const intent = detectOperationalIntent(text) ?? (command.intent as OperationalIntent | undefined);
    if (intent === 'REVERSE_SCAN') command.phase = /\bconfirm\b/i.test(normalizedPhrase(text)) ? 'CONFIRM' : 'PREPARE';
    else command.phase = command.pendingClarification ? 'CLARIFY' : 'VERIFY';
    command.status = command.pendingClarification ? 'COLLECTING' : 'READY'; refreshEntities(command); return;
  }
  const component = resolvedComponent(text);
  if (isResolved(component) && component.canonicalValue) { command.slots.component = component.canonicalValue; command.entities = [component]; }
  command.status = 'COLLECTING'; command.phase = 'CLARIFY';
}

export class CommandRegistry {
  private readonly commands = new Map<string, PendingCommand>();
  private activeId: string | null = null;
  private replyCommandId: string | null = null;
  private sequence = 0;
  private lastEvent: CommandRegistryEvent | null = null;

  acceptFinalTranscript(text: string): PendingCommand {
    const now = Date.now(); this.lastEvent = null; let active = this.current();

    if (isUsable(active)) {
      const pending = active.entityConfirmation?.status === 'PENDING' ? active.entityConfirmation : null;
      if (pending) {
        const incoming = resolvedComponent(text); const incomingResolved = isResolved(incoming) && Boolean(incoming.canonicalValue);
        if (incomingResolved) {
          const receivedValue = incoming.canonicalValue!;
          if (receivedValue === pending.expectedValue) {
            active.fragments.push(text); active.updatedAt = now; active.entityConfirmation = { ...pending, status: 'CONFIRMED', confirmedAt: now };
            if (active.workflow === 'E3_MISTAKEN_SCAN') active.slots.component = receivedValue;
            else if (active.workflow === 'E1_WRONG_COMPONENT') active.slots.observedComponent = receivedValue;
            else active.slots.component = receivedValue;
            active.pendingClarification = undefined; active.status = 'READY'; refreshEntities(active);
            this.lastEvent = { type: 'entity_confirmation', status: 'CONFIRMED', commandId: active.id, entityKind: 'component_id', expectedValue: pending.expectedValue, receivedValue };
            return active;
          }
          const oldId = active.id; active.status = 'INVALIDATED'; active.closedAt = now;
          const wf = workflowFromText(text); const replacement = this.createCommand(text, wf === 'UNKNOWN' ? active.workflow : wf, now);
          if (replacement.workflow === 'E3_MISTAKEN_SCAN') replacement.slots.component = receivedValue;
          else if (replacement.workflow === 'E1_WRONG_COMPONENT') replacement.slots.observedComponent = receivedValue;
          else replacement.slots.component = receivedValue;
          applyTypedText(replacement, text);
          this.lastEvent = { type: 'entity_confirmation', status: 'SUPERSEDED', commandId: oldId, entityKind: 'component_id', expectedValue: pending.expectedValue, receivedValue, replacementCommandId: replacement.id };
          return replacement;
        }
        if (isOperationalContinuation(text)) { active.fragments.push(text); active.updatedAt = now; const clarifiedIntent = detectOperationalIntent(text); if (clarifiedIntent) active.intent = clarifiedIntent; active.status = 'COLLECTING'; return active; }
        active.status = 'INVALIDATED'; active.closedAt = now;
      }

      active = this.current();
      if (isUsable(active) && this.replyCommandId === active.id && isCorrectionUtterance(text)) {
        const old = active; old.status = 'INVALIDATED'; old.closedAt = now;
        const wf = workflowFromText(text); const replacement = this.createCommand(text, wf === 'UNKNOWN' ? old.workflow : wf, now);
        replacement.slots = { ...old.slots };
        const corrected = canonical(resolvedComponent(text));
        if (corrected) { if (replacement.workflow === 'E1_WRONG_COMPONENT') replacement.slots.observedComponent = corrected; else replacement.slots.component = corrected; }
        applyTypedText(replacement, text); return replacement;
      }
      active = this.current();
      if (isUsable(active) && isExplicitCancellation(text)) { active.status = 'INVALIDATED'; active.closedAt = now; }
    }

    const incomingIntent = detectOperationalIntent(text); const incomingWorkflow = workflowFromText(text, incomingIntent); active = this.current();
    if (isUsable(active)) {
      if (this.fillPendingClarification(active, text, now)) return active;
      const sameE3 = active.workflow === 'E3_MISTAKEN_SCAN' && incomingWorkflow === 'E3_MISTAKEN_SCAN';
      const sameE2 = active.workflow === 'E2_MISSING_INVENTORY' && (incomingWorkflow === 'E2_MISSING_INVENTORY' || (incomingWorkflow === 'UNKNOWN' && (isOperationalContinuation(text) || isWakeQualifiedShortResponse(text))));
      const collectingUnknown = active.status === 'COLLECTING' && incomingWorkflow === 'UNKNOWN' && isOperationalContinuation(text);
      if (sameE3 || sameE2 || collectingUnknown) {
        const previousLast = active.fragments.at(-1) ?? ''; active.fragments.push(text); active.updatedAt = now; applyTypedText(active, text); this.requireConfirmationForReconstructedEntity(active, previousLast, text, now); return active;
      }
      // A genuinely new operational intent owns a new commandId; old state is retained only as immutable history.
      if (incomingWorkflow !== 'UNKNOWN' || containsAnyTechnicalId(text)) { active.status = 'COMPLETE'; active.phase = 'COMPLETE'; active.closedAt = now; }
    }
    return this.createCommand(text, incomingWorkflow, now);
  }

  cancelActive(text: string): PendingCommand {
    const now = Date.now(); this.lastEvent = null; const active = this.current();
    if (active && !['INVALIDATED', 'CANCELLED'].includes(active.status)) { active.status = 'INVALIDATED'; active.closedAt = now; }
    const command = this.createCommand(text, 'CANCEL_ACTION', now); command.intent = 'CANCEL_ACTION'; command.phase = 'COMPLETE'; command.status = 'CANCELLED'; command.closedAt = now; return command;
  }

  beginReply(commandId?: string | null): string | null {
    const candidate = commandId === undefined ? this.activeId : commandId;
    this.replyCommandId = candidate && this.commands.has(candidate) ? candidate : null; return this.replyCommandId;
  }
  finishReply(): void { this.replyCommandId = null; }
  commandForToolCall(causalCommandId?: string | null): string {
    const candidate = causalCommandId ?? this.replyCommandId;
    return candidate && this.commands.has(candidate) ? candidate : '';
  }
  isCurrent(commandId: string): boolean { const active = this.current(); return Boolean(commandId && isUsable(active) && active.id === commandId); }
  isReady(commandId: string): boolean { return this.commands.get(commandId)?.status === 'READY'; }
  isCancelled(): boolean { return this.current()?.status === 'CANCELLED'; }
  pendingEntityConfirmation(commandId: string): PendingCommand['entityConfirmation'] | null { const c=this.commands.get(commandId); return c?.entityConfirmation?.status === 'PENDING' ? c.entityConfirmation : null; }
  takeLastEvent(): CommandRegistryEvent | null { const e=this.lastEvent; this.lastEvent=null; return e; }
  invalidate(commandId: string): void { const c=this.commands.get(commandId); if(c){ c.status='INVALIDATED'; c.closedAt=Date.now(); } }
  markComplete(commandId: string): void { const c=this.commands.get(commandId); if(c && !['INVALIDATED','CANCELLED'].includes(c.status)){ c.status='COMPLETE'; c.phase='COMPLETE'; c.closedAt=Date.now(); } }
  current(): PendingCommand | null { return this.activeId ? this.commands.get(this.activeId) ?? null : null; }
  get(commandId: string): PendingCommand | null { return this.commands.get(commandId) ?? null; }
  hasActiveOperationalContext(): boolean { const c=this.current(); return Boolean(isUsable(c) && (c.workflow!=='UNKNOWN' || c.pendingClarification || Object.keys(c.slots).length)); }
  isAwaitingClarification(): boolean { const c=this.current(); return Boolean(c && c.status==='COLLECTING' && (c.pendingClarification || c.entityConfirmation?.status==='PENDING')); }
  reset(): void { this.commands.clear(); this.activeId=null; this.replyCommandId=null; this.lastEvent=null; }
  contextFor(commandId: string): string { const c=this.commands.get(commandId); return c ? commandContext(c) : ''; }
  slotsFor(commandId: string): PendingCommand['slots'] | null { const c=this.commands.get(commandId); return c ? { ...c.slots } : null; }
  workflowFor(commandId: string): WorkflowKind | null { return this.commands.get(commandId)?.workflow ?? null; }

  trustedComponentForTool(commandId: string, toolName: string): string | null {
    const c=this.commands.get(commandId); if(!c) return null;
    if(toolName==='check_component') return c.slots.observedComponent ?? null;
    if(toolName==='check_inventory') return c.workflow==='E1_WRONG_COMPONENT' ? c.slots.expectedComponent ?? null : c.slots.component ?? null;
    if(toolName==='find_alternative_inventory') return c.slots.component ?? c.slots.expectedComponent ?? null;
    return c.slots.component ?? c.slots.observedComponent ?? null;
  }

  bindToolArguments(commandId: string, toolName: string, proposed: Record<string, unknown>): Record<string, unknown> {
    const c=this.commands.get(commandId); if(!c) return { ...proposed }; const args={...proposed};
    if(toolName==='check_component' && c.slots.observedComponent) args.component_id=c.slots.observedComponent;
    if(toolName==='check_inventory' || toolName==='find_alternative_inventory'){ const trusted=this.trustedComponentForTool(commandId,toolName); if(trusted) args.component_id=trusted; }
    if(toolName==='report_exception' && c.workflow==='E1_WRONG_COMPONENT' && c.slots.observedComponent){ args.type='WRONG_COMPONENT'; args.observed_component=c.slots.observedComponent; }
    if(toolName==='report_inventory_discrepancy' && c.workflow==='E2_MISSING_INVENTORY'){ if(c.slots.component) args.component_id=c.slots.component; if(c.slots.reportedLocation) args.location=c.slots.reportedLocation; if(c.slots.observedEmpty===true) args.observed_state='EMPTY'; }
    return args;
  }

  noteToolResult(commandId: string, toolName: string, payload: Record<string, unknown>, verified=false): void {
    const c=this.commands.get(commandId); if(!c) return; c.updatedAt=Date.now();
    if(toolName==='get_current_job'){
      const job=payload.job && typeof payload.job==='object' ? payload.job as Record<string,unknown> : payload; c.evidence.currentJob=job; const expected=normalizeTechnicalId(job.expected_component,'component_id'); if(expected) c.slots.expectedComponent=expected;
    } else if(toolName==='check_component'){
      c.evidence.componentCheck=payload; const observed=normalizeTechnicalId(payload.observed_component,'component_id'); const expected=normalizeTechnicalId(payload.expected_component,'component_id'); if(observed)c.slots.observedComponent=observed; if(expected)c.slots.expectedComponent=expected; c.phase='REPORT';
    } else if(toolName==='check_inventory'){
      const inv=payload.inventory && typeof payload.inventory==='object' ? payload.inventory as Record<string,unknown> : payload; c.evidence.inventoryCheck=inv; const component=normalizeTechnicalId(inv.component,'component_id'); if(component && c.workflow!=='E1_WRONG_COMPONENT') c.slots.component=component;
    } else if(toolName==='find_alternative_inventory'){
      const alt=payload.alternative && typeof payload.alternative==='object' ? payload.alternative as Record<string,unknown> : payload; c.evidence.alternativeInventory=alt; c.phase='COMPLETE';
    } else if(toolName==='inspect_last_action'){
      const action=payload.action && typeof payload.action==='object' ? payload.action as Record<string,unknown> : payload; c.evidence.lastAction=action; const component=normalizeTechnicalId(action.component,'component_id'); const id=String(action.id??'').trim(); if(component)c.slots.component=component; if(id)c.slots.actionId=id;
    } else if(toolName==='report_exception' && verified){ c.evidence.exception=payload; c.phase='BLOCK'; }
    else if(toolName==='update_job_status' && verified){ c.evidence.jobStatus=payload; c.phase='LOCATE'; }
    else if(toolName==='report_inventory_discrepancy' && verified){ c.evidence.discrepancy=payload; c.phase='LOCATE'; }
    else if(toolName==='reverse_last_scan' && verified){ c.evidence.reversal=payload; c.phase='COMPLETE'; }
    refreshEntities(c);
  }

  private createCommand(text: string, workflow: WorkflowKind, now: number): PendingCommand {
    this.sequence += 1; const c=blankCommand(makeCommandId(this.sequence),text,now,workflow); this.commands.set(c.id,c); this.activeId=c.id; applyTypedText(c,text); return c;
  }

  private fillPendingClarification(command: PendingCommand, text: string, now: number): boolean {
    const pending=command.pendingClarification; if(!pending) return false;
    if(command.workflow==='E1_WRONG_COMPONENT' && pending.field==='observedComponent'){
      const comp=canonical(resolvedComponent(text)); if(!comp) return false; command.fragments.push(text); command.updatedAt=now; command.slots.observedComponent=comp; command.pendingClarification=undefined; command.status='READY'; command.phase='VERIFY'; refreshEntities(command); return true;
    }
    if(command.workflow==='E2_MISSING_INVENTORY'){
      // VS-012: the pending field owns the interpretation of a short clarification.
      // Component/location IDs intentionally share lexical shape, so reparsing the whole
      // accumulated command makes a standalone "C12" ambiguous with the earlier B148.
      // Only the new utterance is interpreted, using pending.allowedType as deterministic type.
      const clarificationIds=extractTechnicalIds(text,'component_id');
      if(command.slots.observedEmpty===true && clarificationIds.length===2 && pending.field==='component'){
        // Narrow complete-pair clarification: the worker supplied both missing IDs in this turn.
        // Ordered pair semantics are allowed only because EMPTY was already explicit on this E2.
        command.slots.component=clarificationIds[0];
        command.slots.reportedLocation=clarificationIds[1];
      } else if(pending.field==='component'){
        const component=canonical(resolveCorrectedTechnicalEntity('component_id',text));
        const expected=command.slots.expectedComponent;
        if(component && expected && component!==expected && command.slots.observedEmpty===true){
          // VS-012: after an incomplete component transcript (e.g. STT drops the leading B),
          // get_current_job may establish expected B148 while the worker's next short answer C12
          // is the missing location. Preserve C12 as location, but require explicit B148
          // confirmation before the command can become READY.
          command.slots.reportedLocation=component;
          command.fragments.push(text);
          command.updatedAt=now;
          command.entityConfirmation={kind:'component_id',expectedValue:expected,status:'PENDING',requestedAt:now};
          command.pendingClarification=undefined;
          command.status='COLLECTING';
          command.phase='CLARIFY';
          refreshEntities(command);
          return true;
        }
        if(!component) return false;
        command.slots.component=component;
      } else if(pending.field==='reportedLocation'){
        let location=canonical(resolveCorrectedTechnicalEntity('location_id',text));
        if(!location){
          // A worker may answer with the complete pair ("B148, C12"). Interpret only this
          // clarification utterance: if one ID is the command-owned component, the single
          // remaining ID is the requested location.
          const ids=extractTechnicalIds(text,'location_id');
          const remaining=command.slots.component ? ids.filter((id)=>id!==command.slots.component) : ids;
          if(remaining.length===1) location=remaining[0];
        }
        if(!location) return false;
        command.slots.reportedLocation=location;
      } else if(pending.field==='observedEmpty'){
        if(!/\b(?:empty|yes|correct|right)\b/i.test(normalizedPhrase(text))) return false;
        command.slots.observedEmpty=true;
      } else return false;

      command.fragments.push(text); command.updatedAt=now;
      if(!command.slots.component) command.pendingClarification={workflow:command.workflow,field:'component',allowedType:'component_id'};
      else if(!command.slots.reportedLocation) command.pendingClarification={workflow:command.workflow,field:'reportedLocation',allowedType:'location_id'};
      else if(command.slots.observedEmpty!==true) command.pendingClarification={workflow:command.workflow,field:'observedEmpty',allowedType:'boolean'};
      else command.pendingClarification=undefined;
      command.status=command.pendingClarification?'COLLECTING':'READY'; command.phase=command.pendingClarification?'CLARIFY':'VERIFY'; refreshEntities(command); return true;
    }
    if(command.workflow==='E3_MISTAKEN_SCAN' && pending.field==='component'){
      const comp=canonical(resolvedComponent(text)); if(!comp) return false; command.fragments.push(text); command.updatedAt=now; command.slots.component=comp; command.pendingClarification=undefined; command.status='READY'; command.phase='VERIFY'; refreshEntities(command); return true;
    }
    return false;
  }

  private requireConfirmationForReconstructedEntity(command: PendingCommand, previousLastFragment: string, currentText: string, now: number): void {
    if(command.entityConfirmation || !isIncompleteTechnicalFragment(previousLastFragment)) return;
    const currentOnly=resolvedComponent(currentText); if(isResolved(currentOnly)) return;
    const reconstructed=resolvedComponent(commandContext(command)); if(!isResolved(reconstructed)||!reconstructed.canonicalValue) return;
    command.entityConfirmation={kind:'component_id',expectedValue:reconstructed.canonicalValue,status:'PENDING',requestedAt:now}; command.status='COLLECTING';
    this.lastEvent={type:'entity_confirmation',status:'PENDING',commandId:command.id,entityKind:'component_id',expectedValue:reconstructed.canonicalValue};
  }
}
