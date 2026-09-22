import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { db } from '../db/database.js';
import { assessTranscriptSanity, normalizeTechnicalId } from '../reliability/transcript.js';
import { clearReliabilityEvents, listReliabilityEvents, recordReliabilityEvent } from '../reliability/telemetry.js';
import { clearFault, configureFault, consumeFault, faultInjectionAvailable, getFaultConfig, type FaultPoint } from '../reliability/faults.js';
import { normalizeConfirmation, validatePreparedReversalAuthority } from '../reliability/confirmation.js';

export const apiRouter = Router();

const CURRENT_JOB_ID = 'JOB-482';
const liveClients = new Set<Response>();

type JobRow = {
  id: string;
  worker_id: string;
  station: string;
  expected_component: string;
  status: string;
};

type InventoryRow = {
  component: string;
  location: string;
  quantity: number;
};

type AlternateInventoryRow = InventoryRow;

type ActionRow = {
  id: string;
  job_id: string;
  type: string;
  payload: string | null;
  timestamp: string;
  reversible: number;
  reversed: number;
};

function now() {
  return new Date().toISOString();
}

function normalizeComponent(value: unknown): string {
  return normalizeTechnicalId(value);
}

function commandIdFromRequest(req: { header(name: string): string | undefined }): string {
  return String(req.header('X-VoiceStrike-Command-Id') ?? '').trim();
}

function transcriptFromRequest(req: { header(name: string): string | undefined }): string {
  return String(req.header('X-VoiceStrike-Transcript') ?? '').trim();
}

function mutationContextGuard(
  req: { header(name: string): string | undefined },
  res: Response,
  expectedWorkflow: 'E1_WRONG_COMPONENT' | 'E2_MISSING_INVENTORY' | 'E3_MISTAKEN_SCAN',
): boolean {
  const commandId = commandIdFromRequest(req);
  const transcript = transcriptFromRequest(req);
  const wakeAuthority = String(req.header('X-VoiceStrike-Wake-Authority') ?? '').trim();
  const workflow = String(req.header('X-VoiceStrike-Workflow') ?? '').trim();
  const commandReady = String(req.header('X-VoiceStrike-Command-Ready') ?? '').trim().toLowerCase() === 'true';
  // The transcript remains evidence for basic sanity only. Operational semantics are supplied by
  // the typed CommandContext and re-checked by endpoint-specific deterministic prerequisites.
  const sanity = assessTranscriptSanity(transcript, { requireOperationalSignal: false });

  if (!commandId) {
    res.status(409).json({
      ok: false,
      error: 'COMMAND_ID_REQUIRED',
      message: 'Mutation rejected because no current reliability command ID was supplied.',
    });
    return false;
  }


  if (!commandReady) {
    res.status(409).json({
      ok: false,
      error: 'COMMAND_NOT_READY',
      message: 'Mutation rejected because the typed command context is not READY.',
    });
    return false;
  }

  if (workflow !== expectedWorkflow) {
    res.status(409).json({
      ok: false,
      error: 'WORKFLOW_MISMATCH',
      expected_workflow: expectedWorkflow,
      received_workflow: workflow || null,
      message: 'Mutation rejected because the command workflow does not match this endpoint.',
    });
    return false;
  }


  if (wakeAuthority !== 'WAKE_PHRASE_ACTIVE') {
    recordReliabilityEvent({
      commandId,
      event: 'reliability.wake_required',
      stage: 'AUTHORISE',
      outcome: 'NEEDS_CLARIFICATION',
      detail: 'Mutation rejected because no active VoiceStrike wake phrase window was supplied.',
    });
    res.status(409).json({
      ok: false,
      error: 'WAKE_AUTHORITY_REQUIRED',
      message: 'Mutation rejected because the operational conversation is not wake-authorised. Say VoiceStrike and repeat the request.',
    });
    return false;
  }

  if (!sanity.reliable) {
    recordReliabilityEvent({
      commandId,
      event: 'reliability.transcript_unreliable',
      stage: 'AUTHORISE',
      outcome: 'NEEDS_CLARIFICATION',
      detail: sanity.status,
    });
    res.status(409).json({
      ok: false,
      error: 'TRANSCRIPT_UNRELIABLE',
      transcript_status: sanity.status,
      message: 'Speech input is not sufficient authority for this mutation. Ask the worker to repeat the operational instruction clearly.',
    });
    return false;
  }

  return true;
}

function injectedFailure(res: Response, point: FaultPoint): boolean {
  const fault = consumeFault(point);
  if (!fault) return false;
  recordReliabilityEvent({
    event: 'reliability.failure_injected',
    stage: point,
    outcome: 'TOOL_FAILED',
    detail: `Injected fault at ${point}`,
  });
  res.status(point === 'VERIFY_TIMEOUT' ? 504 : 503).json({
    ok: false,
    error: point === 'VERIFY_TIMEOUT' ? 'INJECTED_VERIFY_TIMEOUT' : 'INJECTED_RELIABILITY_FAULT',
    fault_point: point,
    message: `Reliability test fault injected at ${point}.`,
  });
  return true;
}

function actionView(action: ActionRow) {
  let payload: Record<string, unknown> = {};
  try {
    payload = action.payload ? JSON.parse(action.payload) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }
  const component = normalizeComponent(payload.component);
  return {
    id: action.id,
    job_id: action.job_id,
    type: action.type,
    component: component || null,
    station: String(payload.station ?? ''),
    timestamp: action.timestamp,
    reversible: action.reversible === 1,
    reversed: action.reversed === 1,
    recovery_eligible: action.type === 'SCAN_COMPONENT' && action.reversible === 1 && action.reversed === 0,
  };
}

function getCurrentJob(): JobRow | undefined {
  return db.prepare(
    'SELECT id, worker_id, station, expected_component, status FROM jobs WHERE id = ?',
  ).get(CURRENT_JOB_ID) as JobRow | undefined;
}

function getDashboardState() {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(CURRENT_JOB_ID);
  const inventory = db.prepare('SELECT * FROM inventory ORDER BY component').all();
  const alternatives = db.prepare('SELECT * FROM inventory_alternates ORDER BY component, location').all();
  const exceptions = db.prepare('SELECT * FROM exceptions ORDER BY created_at DESC').all();
  const actions = db.prepare('SELECT * FROM actions WHERE job_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT 5').all(CURRENT_JOB_ID);
  const auditRows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 20').all();

  return { job, inventory, alternatives, exceptions, actions, audit: auditRows };
}

function broadcastState(reason: string, eventId?: number | bigint) {
  if (!liveClients.size) return;
  const payload = JSON.stringify({
    type: 'state',
    reason,
    eventId: eventId == null ? null : Number(eventId),
    serverTime: now(),
    state: getDashboardState(),
  });

  for (const client of liveClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      liveClients.delete(client);
    }
  }
}

function audit(event: string, beforeState: unknown, afterState: unknown, actor = 'VOICE_AGENT') {
  const result = db.prepare(`
    INSERT INTO audit_log (timestamp, actor, event, before_state, after_state)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    now(),
    actor,
    event,
    beforeState == null ? null : JSON.stringify(beforeState),
    afterState == null ? null : JSON.stringify(afterState),
  );

  // Push the authoritative SQLite state to every connected supervisor screen.
  // queueMicrotask lets the current mutation finish before the snapshot is read.
  queueMicrotask(() => broadcastState(event, result.lastInsertRowid));
}

apiRouter.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  liveClients.add(res);

  const initial = JSON.stringify({
    type: 'state',
    reason: 'SSE_CONNECTED',
    eventId: null,
    serverTime: now(),
    state: getDashboardState(),
  });
  res.write(`data: ${initial}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    liveClients.delete(res);
  });
});

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'voicestrike-server',
    build: 7,
    reliability: {
      telemetry: true,
      faultInjectionAvailable: faultInjectionAvailable(),
      faultInjectionActive: getFaultConfig().enabled,
    },
    assemblyaiConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY),
    timestamp: now(),
  });
});

apiRouter.get('/voice-token', async (_req, res) => {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ASSEMBLYAI_API_KEY is not configured',
      detail: 'Create a .env file in the VoiceStrike project root and set ASSEMBLYAI_API_KEY. Never put the key in the browser.',
    });
  }

  try {
    const url = new URL('https://agents.assemblyai.com/v1/token');
    url.searchParams.set('expires_in_seconds', '300');
    url.searchParams.set('max_session_duration_seconds', '1800');

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('AssemblyAI token error:', response.status, detail);
      return res.status(response.status).json({
        error: 'AssemblyAI token request failed',
        detail: response.status === 401 || response.status === 403
          ? 'AssemblyAI rejected the API key. Check ASSEMBLYAI_API_KEY in .env.'
          : `AssemblyAI returned HTTP ${response.status}.`,
      });
    }

    const payload = await response.json() as { token?: string };
    if (!payload.token) {
      return res.status(502).json({ error: 'AssemblyAI returned no temporary token.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ token: payload.token });
  } catch (error) {
    console.error('AssemblyAI token request failed:', error);
    return res.status(502).json({
      error: 'Unable to reach AssemblyAI',
      detail: error instanceof Error ? error.message : 'Unknown network error',
    });
  }
});


apiRouter.get('/reliability/telemetry', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, events: listReliabilityEvents() });
});

apiRouter.post('/reliability/telemetry', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const event = String(body.event ?? '').trim();
  if (!event.startsWith('reliability.')) {
    return res.status(400).json({ ok: false, error: 'INVALID_RELIABILITY_EVENT' });
  }
  const stored = recordReliabilityEvent({
    timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    epoch: typeof body.epoch === 'number' ? body.epoch : null,
    turnId: typeof body.turnId === 'string' ? body.turnId : null,
    commandId: typeof body.commandId === 'string' ? body.commandId : null,
    actionId: typeof body.actionId === 'string' ? body.actionId : null,
    componentId: typeof body.componentId === 'string' ? body.componentId : null,
    authorityId: typeof body.authorityId === 'string' ? body.authorityId : null,
    tool: typeof body.tool === 'string' ? body.tool : undefined,
    attempted: typeof body.attempted === 'boolean' ? body.attempted : undefined,
    resultClass: typeof body.resultClass === 'string' ? body.resultClass : undefined,
    event,
    intent: typeof body.intent === 'string' ? body.intent : undefined,
    entityKind: typeof body.entityKind === 'string' ? body.entityKind : undefined,
    entityValue: typeof body.entityValue === 'string' ? body.entityValue : undefined,
    jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
    stage: typeof body.stage === 'string' ? body.stage : undefined,
    outcome: typeof body.outcome === 'string' ? body.outcome : undefined,
    latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
    detail: typeof body.detail === 'string' ? body.detail.slice(0, 500) : undefined,
  });
  return res.status(201).json({ ok: true, event: stored });
});

/**
 * v0.9.0 (spec section 10) — reliability metrics derived from recorded telemetry only.
 *
 * Nothing here is estimated or modelled. Every counter is a count of events that actually
 * happened in this process, so a runtime campaign can compute Unsafe Action Rate and False
 * Success Rate from evidence instead of from a claim. Accent/noise/keyterms metrics are NOT
 * produced here: they require real audio and are recorded by the human runtime campaign.
 */
apiRouter.get('/reliability/metrics', (_req, res) => {
  const events = listReliabilityEvents();
  const count = (predicate: (event: { event: string; attempted?: boolean; resultClass?: string; outcome?: string }) => boolean) =>
    events.filter(predicate).length;

  const mutationAttempts = count((e) => e.event === 'reliability.tool_attempted' && e.resultClass === 'MUTATION_REQUEST_SENT');
  const verifiedSuccesses = count((e) => e.event === 'reliability.verified_success');
  const blockedLocal = count((e) => e.event === 'reliability.tool_blocked_local');
  const preconditionRequired = count((e) => e.event === 'reliability.workflow_precondition_required');
  const staleAttempts = count((e) => e.event === 'reliability.command_invalidated');
  const cancelledActions = count((e) => e.event === 'reliability.protected_action_cancelled');
  const expiredActions = count((e) => e.event === 'reliability.protected_action_expired');
  const ambientRejected = count((e) => e.event === 'reliability.ambient_turn_rejected');
  const orphanReplies = count((e) => e.event === 'reliability.orphan_reply_suppressed');
  const repliesBound = count((e) => e.event === 'reliability.reply_bound_to_turn');
  const falseSuccessClaims = count((e) => e.event === 'reliability.tool_result' && e.resultClass === 'VERIFIED_SUCCESS')
    - verifiedSuccesses;
  const latencies = events
    .map((e) => (typeof e.latencyMs === 'number' ? e.latencyMs : null))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    source: 'reliability_telemetry',
    events: events.length,
    epochs: Array.from(new Set(events.map((e) => e.epoch ?? null))).filter((value) => value != null),
    counters: {
      mutation_attempts: mutationAttempts,
      verified_successes: verifiedSuccesses,
      blocked_local_requests: blockedLocal,
      workflow_precondition_required: preconditionRequired,
      stale_or_invalidated_command_attempts: staleAttempts,
      cancelled_protected_actions: cancelledActions,
      expired_protected_actions: expiredActions,
      ambient_rejected_turns: ambientRejected,
      orphan_replies_suppressed: orphanReplies,
      replies_bound_to_accepted_turn: repliesBound,
    },
    rates: {
      unsafe_action_rate: 'requires runtime campaign: unsafe mutations / unsafe inputs',
      false_success_rate_observed: Math.max(0, falseSuccessClaims),
      verified_success_ratio: mutationAttempts ? verifiedSuccesses / mutationAttempts : null,
    },
    latency_ms: latencies.length
      ? { samples: latencies.length, p50: latencies[Math.floor(latencies.length * 0.5)], p95: latencies[Math.floor(latencies.length * 0.95)] }
      : null,
    note: 'Accent, noise and keyterms A/B metrics are not derivable here; they require measured real audio.',
  });
});

apiRouter.delete('/reliability/telemetry', (_req, res) => {
  clearReliabilityEvents();
  return res.json({ ok: true });
});

apiRouter.get('/reliability/fault', (_req, res) => {
  return res.json({
    ok: true,
    available: faultInjectionAvailable(),
    config: getFaultConfig(),
  });
});

apiRouter.post('/reliability/fault', (req, res) => {
  if (!faultInjectionAvailable()) {
    return res.status(403).json({
      ok: false,
      error: 'FAULT_INJECTION_DISABLED',
      message: 'Set VOICESTRIKE_ENABLE_RELIABILITY_FAULTS=true in a non-production environment to use fault injection.',
    });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const point = typeof body.point === 'string' ? body.point as FaultPoint : undefined;
  const config = configureFault({
    enabled: body.enabled !== false,
    point,
    once: body.once !== false,
    delayMs: typeof body.delayMs === 'number' ? body.delayMs : 0,
  });
  return res.json({ ok: true, config });
});

apiRouter.delete('/reliability/fault', (_req, res) => {
  clearFault();
  return res.json({ ok: true });
});

apiRouter.post('/voice-session', (req, res) => {
  const { sessionId, startedAt, region } = req.body as {
    sessionId?: string;
    startedAt?: string;
    region?: string;
  };

  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  audit('VOICE_SESSION_STARTED', null, {
    session_id: sessionId,
    started_at: startedAt ?? null,
    region: region ?? 'US',
  });

  return res.status(201).json({ ok: true });
});

apiRouter.get('/tools/get-current-job', (_req, res) => {
  if (injectedFailure(res, 'GET_CURRENT_JOB_BEFORE')) return;
  const job = getCurrentJob();

  if (!job) {
    audit('TOOL_GET_CURRENT_JOB_FAILED', null, { reason: 'NO_CURRENT_JOB' });
    return res.status(404).json({
      ok: false,
      error: 'NO_CURRENT_JOB',
      message: 'No current job is available for the demo worker.',
    });
  }

  audit('TOOL_GET_CURRENT_JOB', null, job);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, source: 'voicestrike_sqlite', job });
});

apiRouter.post('/tools/check-component', (req, res) => {
  if (injectedFailure(res, 'CHECK_COMPONENT_BEFORE')) return;
  const reliabilityCommandId = commandIdFromRequest(req);
  const observedComponent = normalizeComponent(req.body?.componentId);
  const job = getCurrentJob();

  if (!observedComponent) {
    return res.status(400).json({
      ok: false,
      error: 'COMPONENT_ID_REQUIRED',
      message: 'A component identifier is required.',
    });
  }

  if (!job) {
    return res.status(404).json({ ok: false, error: 'NO_CURRENT_JOB', message: 'No current job is available.' });
  }

  const expectedComponent = normalizeComponent(job.expected_component);
  const match = observedComponent === expectedComponent;
  const result = {
    job_id: job.id,
    observed_component: observedComponent,
    expected_component: expectedComponent,
    verdict: match ? 'MATCH' : 'MISMATCH',
    safe_to_continue: match,
    reliability_command_id: reliabilityCommandId || null,
  };

  audit('TOOL_CHECK_COMPONENT', null, result);
  return res.json({ ok: true, source: 'voicestrike_sqlite', ...result });
});

apiRouter.post('/tools/report-exception', (req, res) => {
  if (!mutationContextGuard(req, res, 'E1_WRONG_COMPONENT')) return;
  const reliabilityCommandId = commandIdFromRequest(req);
  if (injectedFailure(res, 'REPORT_EXCEPTION_BEFORE')) return;
  const type = String(req.body?.type ?? '').toUpperCase();
  const observedComponent = normalizeComponent(req.body?.observedComponent);
  const details = String(req.body?.details ?? '').trim().slice(0, 500);
  const job = getCurrentJob();

  if (type !== 'WRONG_COMPONENT') {
    audit('TOOL_REPORT_EXCEPTION_REJECTED', null, { reason: 'UNSUPPORTED_TYPE', type });
    return res.status(400).json({ ok: false, error: 'UNSUPPORTED_EXCEPTION_TYPE', message: 'Build 5 uses this endpoint only for WRONG_COMPONENT exceptions; inventory discrepancies use a dedicated deterministic tool.' });
  }

  if (!observedComponent) {
    return res.status(400).json({ ok: false, error: 'COMPONENT_ID_REQUIRED', message: 'Observed component is required.' });
  }

  if (!job) {
    return res.status(404).json({ ok: false, error: 'NO_CURRENT_JOB', message: 'No current job is available.' });
  }

  const expectedComponent = normalizeComponent(job.expected_component);
  if (observedComponent === expectedComponent) {
    audit('TOOL_REPORT_EXCEPTION_REJECTED', null, {
      reason: 'NO_MISMATCH',
      observed_component: observedComponent,
      expected_component: expectedComponent,
    });
    return res.status(409).json({
      ok: false,
      error: 'NO_MISMATCH',
      message: 'Code rejected the exception because the observed component matches the job requirement.',
    });
  }

  // Deterministic sequencing gate: a mutation is authorised only after the same
  // observed component has been checked as a mismatch against the same job.
  const recentChecks = db.prepare(`
    SELECT timestamp, after_state
    FROM audit_log
    WHERE event = 'TOOL_CHECK_COMPONENT'
    ORDER BY id DESC LIMIT 10
  `).all() as Array<{ timestamp: string; after_state: string | null }>;

  const cutoff = Date.now() - 2 * 60 * 1000;
  const matchingCheck = recentChecks.find((row) => {
    if (new Date(row.timestamp).getTime() < cutoff || !row.after_state) return false;
    try {
      const state = JSON.parse(row.after_state) as Record<string, unknown>;
      return String(state.reliability_command_id ?? '') === reliabilityCommandId
        && state.job_id === job.id
        && normalizeComponent(state.observed_component) === observedComponent
        && normalizeComponent(state.expected_component) === expectedComponent
        && state.verdict === 'MISMATCH';
    } catch {
      return false;
    }
  });

  if (!matchingCheck) {
    audit('TOOL_REPORT_EXCEPTION_REJECTED', null, {
      reason: 'NO_RECENT_VERIFIED_MISMATCH',
      observed_component: observedComponent,
      expected_component: expectedComponent,
    });
    return res.status(409).json({
      ok: false,
      error: 'NO_VERIFIED_MISMATCH',
      message: 'Code refused to create the exception because no recent verified mismatch exists for this component.',
    });
  }

  const existing = db.prepare(`
    SELECT id, job_id, type, description, status, created_at, resolved_at
    FROM exceptions
    WHERE job_id = ? AND type = 'WRONG_COMPONENT' AND status = 'OPEN'
    ORDER BY created_at DESC LIMIT 1
  `).get(job.id) as Record<string, unknown> | undefined;

  if (existing) {
    audit('TOOL_REPORT_EXCEPTION_DEDUPED', null, { ...existing, reliability_command_id: reliabilityCommandId || null });
    return res.json({ ok: true, source: 'voicestrike_sqlite', created: false, exception: existing, reliability_command_id: reliabilityCommandId || null, verified: false, verification_required: true });
  }

  const exception = {
    id: `EXC-${randomUUID().slice(0, 8).toUpperCase()}`,
    job_id: job.id,
    type: 'WRONG_COMPONENT',
    description: details || `Observed ${observedComponent}; expected ${expectedComponent}.`,
    status: 'OPEN',
    created_at: now(),
    resolved_at: null,
  };

  db.prepare(`
    INSERT INTO exceptions (id, job_id, type, description, status, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    exception.id,
    exception.job_id,
    exception.type,
    exception.description,
    exception.status,
    exception.created_at,
    exception.resolved_at,
  );

  audit('TOOL_REPORT_EXCEPTION', null, {
    ...exception,
    observed_component: observedComponent,
    expected_component: expectedComponent,
    reliability_command_id: reliabilityCommandId || null,
    verified: false,
    verification_required: true,
  });

  return res.status(201).json({
    ok: true,
    source: 'voicestrike_sqlite',
    created: true,
    exception,
    observed_component: observedComponent,
    expected_component: expectedComponent,
    reliability_command_id: reliabilityCommandId || null,
    verified: false,
    verification_required: true,
  });
});

apiRouter.post('/tools/update-job-status', (req, res) => {
  if (!mutationContextGuard(req, res, 'E1_WRONG_COMPONENT')) return;
  const reliabilityCommandId = commandIdFromRequest(req);
  if (injectedFailure(res, 'UPDATE_JOB_STATUS_BEFORE')) return;
  const requestedStatus = String(req.body?.status ?? '').toUpperCase();
  const job = getCurrentJob();

  if (requestedStatus !== 'BLOCKED') {
    audit('TOOL_UPDATE_JOB_STATUS_REJECTED', job ?? null, { requested_status: requestedStatus, reason: 'UNAUTHORISED_STATUS' });
    return res.status(400).json({
      ok: false,
      error: 'UNAUTHORISED_STATUS',
      message: 'Build 5 only authorises transition to BLOCKED through the wrong-component workflow.',
    });
  }

  if (!job) {
    return res.status(404).json({ ok: false, error: 'NO_CURRENT_JOB', message: 'No current job is available.' });
  }

  const exception = db.prepare(`
    SELECT id, type, status
    FROM exceptions
    WHERE job_id = ? AND type = 'WRONG_COMPONENT' AND status = 'OPEN'
    ORDER BY created_at DESC LIMIT 1
  `).get(job.id) as { id: string; type: string; status: string } | undefined;

  if (!exception) {
    audit('TOOL_UPDATE_JOB_STATUS_REJECTED', job, { requested_status: requestedStatus, reason: 'NO_OPEN_WRONG_COMPONENT_EXCEPTION' });
    return res.status(409).json({
      ok: false,
      error: 'NO_AUTHORITY_TO_BLOCK',
      message: 'Code refused to block the job because no open WRONG_COMPONENT exception exists.',
    });
  }

  const recentExceptionAudits = db.prepare(`
    SELECT timestamp, after_state FROM audit_log
    WHERE event IN ('TOOL_REPORT_EXCEPTION','TOOL_REPORT_EXCEPTION_DEDUPED')
    ORDER BY id DESC LIMIT 10
  `).all() as Array<{ timestamp: string; after_state: string | null }>;
  const exceptionAuditCutoff = Date.now() - 2 * 60 * 1000;
  const sameCommandException = recentExceptionAudits.some((row) => {
    if (new Date(row.timestamp).getTime() < exceptionAuditCutoff || !row.after_state) return false;
    try { const state = JSON.parse(row.after_state) as Record<string, unknown>; return String(state.reliability_command_id ?? '') === reliabilityCommandId && String(state.job_id ?? '') === String(job.id); } catch { return false; }
  });
  if (!sameCommandException) return res.status(409).json({ ok: false, error: 'NO_COMMAND_BOUND_EXCEPTION', message: 'Code refused to block the job because this command does not own the verified wrong-component exception.' });

  if (job.status === 'BLOCKED') {
    return res.json({ ok: true, source: 'voicestrike_sqlite', changed: false, job, authority: { exception_id: exception.id }, verified: false, verification_required: true });
  }

  const before = { ...job };
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('BLOCKED', job.id);
  const after = getCurrentJob();
  audit('TOOL_UPDATE_JOB_STATUS', before, { ...after, authority_exception_id: exception.id, reliability_command_id: reliabilityCommandId || null });

  return res.json({
    ok: true,
    source: 'voicestrike_sqlite',
    changed: true,
    job: after,
    authority: { exception_id: exception.id, reason: 'OPEN_WRONG_COMPONENT_EXCEPTION' },
    verified: false,
    verification_required: true,
  });
});

apiRouter.post('/tools/check-inventory', (req, res) => {
  const reliabilityCommandId = commandIdFromRequest(req);
  const componentId = normalizeComponent(req.body?.componentId);
  if (!componentId) {
    return res.status(400).json({ ok: false, error: 'COMPONENT_ID_REQUIRED', message: 'A component identifier is required.' });
  }

  const item = db.prepare('SELECT component, location, quantity FROM inventory WHERE component = ?').get(componentId) as InventoryRow | undefined;
  if (!item) {
    audit('TOOL_CHECK_INVENTORY', null, { component: componentId, found: false, reliability_command_id: reliabilityCommandId || null });
    return res.status(404).json({
      ok: false,
      error: 'COMPONENT_NOT_FOUND',
      message: `No inventory record exists for ${componentId}.`,
      component: componentId,
    });
  }

  const result = { ...item, available: item.quantity > 0, reliability_command_id: reliabilityCommandId || null };
  audit('TOOL_CHECK_INVENTORY', null, result);
  return res.json({ ok: true, source: 'voicestrike_sqlite', inventory: result });
});

apiRouter.post('/tools/report-inventory-discrepancy', (req, res) => {
  if (!mutationContextGuard(req, res, 'E2_MISSING_INVENTORY')) return;
  const reliabilityCommandId = commandIdFromRequest(req);
  if (injectedFailure(res, 'REPORT_INVENTORY_DISCREPANCY_BEFORE')) return;
  const componentId = normalizeComponent(req.body?.componentId);
  const location = normalizeTechnicalId(req.body?.location);
  const observedState = String(req.body?.observedState ?? '').toUpperCase();
  const job = getCurrentJob();

  if (!componentId || !location) {
    return res.status(400).json({ ok: false, error: 'COMPONENT_AND_LOCATION_REQUIRED', message: 'Component and location are required.' });
  }
  if (observedState !== 'EMPTY') {
    audit('TOOL_REPORT_INVENTORY_DISCREPANCY_REJECTED', null, { reason: 'UNSUPPORTED_OBSERVATION', component: componentId, location, observed_state: observedState });
    return res.status(400).json({ ok: false, error: 'UNSUPPORTED_OBSERVATION', message: 'Build 5 only accepts an explicit EMPTY observation.' });
  }
  if (!job) {
    return res.status(404).json({ ok: false, error: 'NO_CURRENT_JOB', message: 'No current job is available.' });
  }
  if (normalizeComponent(job.expected_component) !== componentId) {
    audit('TOOL_REPORT_INVENTORY_DISCREPANCY_REJECTED', null, { reason: 'NOT_CURRENT_JOB_COMPONENT', component: componentId, expected_component: job.expected_component });
    return res.status(409).json({ ok: false, error: 'NOT_CURRENT_JOB_COMPONENT', message: 'Code refused the discrepancy because the component is not the current job requirement.' });
  }

  // Deterministic sequencing gate: the system must have just checked this exact
  // authoritative component/location and found positive system stock before a
  // worker-reported EMPTY state may update operational availability.
  const recentChecks = db.prepare(`
    SELECT timestamp, after_state
    FROM audit_log
    WHERE event = 'TOOL_CHECK_INVENTORY'
    ORDER BY id DESC LIMIT 10
  `).all() as Array<{ timestamp: string; after_state: string | null }>;

  const cutoff = Date.now() - 2 * 60 * 1000;
  const matchingCheck = recentChecks.find((row) => {
    if (new Date(row.timestamp).getTime() < cutoff || !row.after_state) return false;
    try {
      const state = JSON.parse(row.after_state) as Record<string, unknown>;
      return String(state.reliability_command_id ?? '') === reliabilityCommandId
        && normalizeComponent(state.component) === componentId
        && String(state.location ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === location
        && Number(state.quantity ?? 0) > 0
        && state.available === true;
    } catch {
      return false;
    }
  });

  if (!matchingCheck) {
    audit('TOOL_REPORT_INVENTORY_DISCREPANCY_REJECTED', null, { reason: 'NO_RECENT_POSITIVE_STOCK_CHECK', component: componentId, location });
    return res.status(409).json({ ok: false, error: 'NO_VERIFIED_SYSTEM_STOCK', message: 'Code refused the discrepancy because no recent positive system-stock check exists for that exact component and location.' });
  }

  const item = db.prepare('SELECT component, location, quantity FROM inventory WHERE component = ?').get(componentId) as InventoryRow | undefined;
  if (!item || item.location !== location) {
    audit('TOOL_REPORT_INVENTORY_DISCREPANCY_REJECTED', null, { reason: 'LOCATION_MISMATCH', component: componentId, location, system_location: item?.location ?? null });
    return res.status(409).json({ ok: false, error: 'LOCATION_MISMATCH', message: 'The reported empty location does not match the authoritative inventory location.' });
  }

  const existing = db.prepare(`
    SELECT id, job_id, type, description, status, created_at, resolved_at
    FROM exceptions
    WHERE job_id = ? AND type = 'INVENTORY_DISCREPANCY' AND status = 'OPEN'
    ORDER BY created_at DESC LIMIT 1
  `).get(job.id) as Record<string, unknown> | undefined;

  if (existing) {
    audit('TOOL_REPORT_INVENTORY_DISCREPANCY_DEDUPED', null, { ...existing, reliability_command_id: reliabilityCommandId || null });
    return res.json({ ok: true, source: 'voicestrike_sqlite', created: false, exception: existing, reliability_command_id: reliabilityCommandId || null, verified: false, verification_required: true });
  }

  const exception = {
    id: `EXC-${randomUUID().slice(0, 8).toUpperCase()}`,
    job_id: job.id,
    type: 'INVENTORY_DISCREPANCY',
    description: `Worker reported ${componentId} location ${location} empty; system previously showed ${item.quantity}.`,
    status: 'OPEN',
    created_at: now(),
    resolved_at: null,
  };

  const mutation = db.transaction(() => {
    db.prepare(`
      INSERT INTO exceptions (id, job_id, type, description, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(exception.id, exception.job_id, exception.type, exception.description, exception.status, exception.created_at, exception.resolved_at);
    db.prepare('UPDATE inventory SET quantity = 0 WHERE component = ? AND location = ?').run(componentId, location);
  });
  mutation();

  const afterInventory = db.prepare('SELECT component, location, quantity FROM inventory WHERE component = ?').get(componentId) as InventoryRow;
  audit('TOOL_REPORT_INVENTORY_DISCREPANCY', item, {
    exception,
    inventory: afterInventory,
    observed_state: 'EMPTY',
    authority: 'WORKER_REPORT_AFTER_VERIFIED_SYSTEM_STOCK',
    reliability_command_id: reliabilityCommandId || null,
  });

  return res.status(201).json({
    ok: true,
    source: 'voicestrike_sqlite',
    created: true,
    exception,
    inventory: afterInventory,
    note: 'Primary location marked operationally unavailable from a worker report after deterministic verification of the prior system record.',
    verified: false,
    verification_required: true,
  });
});

apiRouter.post('/tools/find-alternative-inventory', (req, res) => {
  const reliabilityCommandId = commandIdFromRequest(req);
  const componentId = normalizeComponent(req.body?.componentId);
  if (!componentId) {
    return res.status(400).json({ ok: false, error: 'COMPONENT_ID_REQUIRED', message: 'A component identifier is required.' });
  }

  const alternate = db.prepare(`
    SELECT component, location, quantity
    FROM inventory_alternates
    WHERE component = ? AND quantity > 0
    ORDER BY quantity DESC, location ASC
    LIMIT 1
  `).get(componentId) as AlternateInventoryRow | undefined;

  const result = alternate
    ? { component: componentId, found: true, location: alternate.location, quantity: alternate.quantity, available: true, reliability_command_id: reliabilityCommandId || null }
    : { component: componentId, found: false, location: null, quantity: 0, available: false, reliability_command_id: reliabilityCommandId || null };

  audit('TOOL_FIND_ALTERNATIVE_INVENTORY', null, result);
  if (!alternate) {
    return res.status(404).json({ ok: false, error: 'NO_ALTERNATIVE_STOCK', message: `No alternative stock is available for ${componentId}.`, alternative: result });
  }
  return res.json({ ok: true, source: 'voicestrike_sqlite', alternative: result });
});

apiRouter.get('/tools/inspect-last-action', (req, res) => {
  if (req.header('X-VoiceStrike-Verification') === 'post-mutation') {
    if (injectedFailure(res, 'VERIFY_TIMEOUT')) return;
    if (injectedFailure(res, 'VERIFY_BEFORE')) return;
  }
  const action = db.prepare(`
    SELECT id, job_id, type, payload, timestamp, reversible, reversed
    FROM actions
    WHERE job_id = ?
    ORDER BY timestamp DESC, rowid DESC
    LIMIT 1
  `).get(CURRENT_JOB_ID) as ActionRow | undefined;

  if (!action) {
    audit('TOOL_INSPECT_LAST_ACTION_FAILED', null, { reason: 'NO_ACTION' });
    return res.status(404).json({ ok: false, error: 'NO_ACTION', message: 'No recent operational action exists for the current job.' });
  }

  const view = actionView(action);
  const reliabilityCommandId = commandIdFromRequest(req);
  audit('TOOL_INSPECT_LAST_ACTION', null, {
    ...view,
    reliability_command_id: reliabilityCommandId || null,
  });
  return res.json({ ok: true, source: 'voicestrike_sqlite', action: view });
});

// v0.8.7 recovery-authority restoration. This endpoint does NOT inspect or mutate.
// It only proves that the exact command/component already had a recent authoritative
// TOOL_INSPECT_LAST_ACTION result that was recovery-eligible.
apiRouter.get('/reliability/recovery-context', (req, res) => {
  const commandId = String(req.query.commandId ?? '').trim();
  const componentId = normalizeComponent(req.query.componentId);
  if (!commandId || !componentId) {
    return res.status(400).json({
      ok: false,
      error: 'COMMAND_AND_COMPONENT_REQUIRED',
      message: 'A commandId and componentId are required to restore recovery inspection authority.',
    });
  }

  const rows = db.prepare(`
    SELECT timestamp, after_state
    FROM audit_log
    WHERE event = 'TOOL_INSPECT_LAST_ACTION'
    ORDER BY id DESC LIMIT 20
  `).all() as Array<{ timestamp: string; after_state: string | null }>;

  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const row of rows) {
    if (new Date(row.timestamp).getTime() < cutoff || !row.after_state) continue;
    try {
      const state = JSON.parse(row.after_state) as Record<string, unknown>;
      const stateCommandId = String(state.reliability_command_id ?? '').trim();
      const stateComponentId = normalizeComponent(state.component);
      const actionId = String(state.id ?? '').trim();
      if (
        stateCommandId === commandId &&
        stateComponentId === componentId &&
        state.recovery_eligible === true &&
        actionId
      ) {
        return res.json({
          ok: true,
          source: 'voicestrike_audit',
          authority: {
            command_id: commandId,
            action_id: actionId,
            component_id: componentId,
            inspected_at: row.timestamp,
            recovery_eligible: true,
          },
        });
      }
    } catch {
      // Ignore malformed historical audit rows; they cannot become authority.
    }
  }

  return res.status(404).json({
    ok: false,
    error: 'NO_RECENT_COMMAND_BOUND_INSPECTION',
    message: 'No recent recovery-eligible inspection exists for this exact command and component.',
  });
});

apiRouter.post('/tools/reverse-last-scan', (req, res) => {
  if (!mutationContextGuard(req, res, 'E3_MISTAKEN_SCAN')) return;
  if (injectedFailure(res, 'REVERSE_BEFORE')) return;
  const requestedActionId = String(req.body?.actionId ?? '').trim();
  const requestedComponent = normalizeComponent(req.body?.componentId);
  const confirmationText = normalizeConfirmation(req.body?.confirmationText);

  const action = db.prepare(`
    SELECT id, job_id, type, payload, timestamp, reversible, reversed
    FROM actions
    WHERE job_id = ?
    ORDER BY timestamp DESC, rowid DESC
    LIMIT 1
  `).get(CURRENT_JOB_ID) as ActionRow | undefined;

  if (!action) {
    audit('TOOL_REVERSE_LAST_SCAN_REJECTED', null, { reason: 'NO_ACTION' });
    return res.status(404).json({ ok: false, error: 'NO_ACTION', message: 'There is no last action to reverse.' });
  }

  const view = actionView(action);
  if (action.type !== 'SCAN_COMPONENT' || action.reversible !== 1) {
    audit('TOOL_REVERSE_LAST_SCAN_REJECTED', view, { reason: 'NOT_REVERSIBLE_SCAN' });
    return res.status(409).json({ ok: false, error: 'NOT_REVERSIBLE_SCAN', message: 'The last action is not an authorised reversible component scan.' });
  }
  if (action.reversed === 1) {
    audit('TOOL_REVERSE_LAST_SCAN_DEDUPED', view, { reason: 'ALREADY_REVERSED' });
    return res.json({
    ok: true,
    source: 'voicestrike_sqlite',
    changed: false,
    action: view,
    reversal_executed: false,
    verified: false,
    verification_required: true,
  });
  }
  if (!requestedActionId || requestedActionId !== action.id) {
    audit('TOOL_REVERSE_LAST_SCAN_REJECTED', view, { reason: 'ACTION_ID_MISMATCH', requested_action_id: requestedActionId });
    return res.status(409).json({ ok: false, error: 'ACTION_ID_MISMATCH', message: 'Code refused reversal because the requested action is not the current last action.' });
  }
  if (!requestedComponent || requestedComponent !== view.component) {
    audit('TOOL_REVERSE_LAST_SCAN_REJECTED', view, { reason: 'COMPONENT_MISMATCH', requested_component: requestedComponent });
    return res.status(409).json({ ok: false, error: 'COMPONENT_MISMATCH', message: 'Code refused reversal because the confirmed component does not match the scanned component.' });
  }

  // Deterministic sequencing gate: the exact action must have been inspected recently.
  const recentInspections = db.prepare(`
    SELECT timestamp, after_state
    FROM audit_log
    WHERE event = 'TOOL_INSPECT_LAST_ACTION'
    ORDER BY id DESC LIMIT 10
  `).all() as Array<{ timestamp: string; after_state: string | null }>;
  const cutoff = Date.now() - 2 * 60 * 1000;
  const inspected = recentInspections.find((row) => {
    if (new Date(row.timestamp).getTime() < cutoff || !row.after_state) return false;
    try {
      const state = JSON.parse(row.after_state) as Record<string, unknown>;
      return state.id === action.id && state.component === view.component && state.recovery_eligible === true;
    } catch {
      return false;
    }
  });
  if (!inspected) {
    audit('TOOL_REVERSE_LAST_SCAN_REJECTED', view, { reason: 'NO_RECENT_INSPECTION' });
    return res.status(409).json({ ok: false, error: 'NO_RECENT_INSPECTION', message: 'Code refused reversal because the exact last action was not recently inspected as recovery-eligible.' });
  }

  // BUILD 7 v0.8.4 two-step authority gate.
  // The browser may send this mutation only after an earlier, separate worker turn
  // prepared the exact command/action/component. These headers are deterministic
  // browser state; they cannot be supplied through LLM tool arguments.
  const currentCommandId = commandIdFromRequest(req);
  const currentTurnId = String(req.header('X-VoiceStrike-Turn-Id') ?? '').trim();
  const preparedCommandId = String(req.header('X-VoiceStrike-Prepared-Command-Id') ?? '').trim();
  const preparedTurnId = String(req.header('X-VoiceStrike-Prepared-Turn-Id') ?? '').trim();
  const preparedActionId = String(req.header('X-VoiceStrike-Prepared-Action-Id') ?? '').trim();
  const preparedComponent = normalizeComponent(req.header('X-VoiceStrike-Prepared-Component-Id'));

  const preparedAuthority = validatePreparedReversalAuthority({
    currentCommandId,
    currentTurnId,
    preparedCommandId,
    preparedTurnId,
    preparedActionId,
    preparedComponent,
    actualActionId: action.id,
    actualComponent: String(view.component ?? ''),
    confirmationText,
  });

  if (!preparedAuthority.ok) {
    audit('TOOL_REVERSE_LAST_SCAN_REJECTED', view, {
      reason: preparedAuthority.code,
      current_command_id: currentCommandId || null,
      current_turn_id: currentTurnId || null,
      prepared_command_id: preparedCommandId || null,
      prepared_turn_id: preparedTurnId || null,
      confirmation_text: confirmationText || null,
    });
    return res.status(409).json({
      ok: false,
      error: preparedAuthority.code,
      message: preparedAuthority.code === 'SECOND_CONFIRMATION_REQUIRED'
        ? 'The reversal must be prepared in one worker turn and confirmed in a separate turn before it can execute.'
        : `Say "VoiceStrike, confirm reverse scan ${view.component}" to execute this prepared recovery action. Bare yes/no/okay is not sufficient.`,
    });
  }

  const before = view;
  db.prepare('UPDATE actions SET reversed = 1 WHERE id = ? AND reversed = 0').run(action.id);
  const afterRow = db.prepare(`
    SELECT id, job_id, type, payload, timestamp, reversible, reversed
    FROM actions WHERE id = ?
  `).get(action.id) as ActionRow;
  const after = actionView(afterRow);
  audit('TOOL_REVERSE_LAST_SCAN', before, {
    ...after,
    authority: 'RECENT_INSPECTION_PLUS_TWO_STEP_ACTION_SPECIFIC_USER_CONFIRMATION',
    prepared_command_id: preparedCommandId,
    prepared_turn_id: preparedTurnId,
    confirmation_turn_id: currentTurnId,
    confirmation: `VOICESTRIKE CONFIRM REVERSE SCAN ${view.component}`,
  });

  if (consumeFault('REVERSE_AFTER_MUTATION')) {
    recordReliabilityEvent({
      commandId: commandIdFromRequest(req),
      event: 'reliability.failure_injected',
      stage: 'REVERSE_AFTER_MUTATION',
      outcome: 'UNKNOWN_ACTION_STATE',
      detail: 'Reversal committed; response intentionally failed before the client could trust the mutation result.',
    });
    return res.status(503).json({
      ok: false,
      error: 'INJECTED_POST_MUTATION_FAILURE',
      unknown_action_state: true,
      action_id: after.id,
      component: after.component,
      message: 'The mutation may have completed. Do not retry; inspect authoritative state first.',
    });
  }

  return res.json({
    ok: true,
    source: 'voicestrike_sqlite',
    changed: true,
    action: after,
    reversal_executed: true,
    verified: false,
    verification_required: true,
  });
});

apiRouter.post('/demo/reset', (_req, res) => {
  const reset = db.transaction(() => {
    db.prepare('DELETE FROM exceptions WHERE job_id = ?').run(CURRENT_JOB_ID);
    db.prepare('DELETE FROM actions WHERE job_id = ?').run(CURRENT_JOB_ID);
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('IN_PROGRESS', CURRENT_JOB_ID);
    db.prepare(`UPDATE inventory SET location = 'C12', quantity = 7 WHERE component = 'B148'`).run();
    db.prepare(`INSERT OR REPLACE INTO inventory_alternates (component, location, quantity) VALUES ('B148', 'D05', 4)`).run();
    db.prepare(`INSERT INTO actions (id, job_id, type, payload, timestamp, reversible, reversed) VALUES (?, ?, 'SCAN_COMPONENT', ?, ?, 1, 0)`).run(
      'ACT-SCAN-B184', CURRENT_JOB_ID, JSON.stringify({ component: 'B184', station: '3040' }), now(),
    );
    audit('DEMO_RESET', null, { job: CURRENT_JOB_ID, status: 'IN_PROGRESS', exceptions: 0, b148_primary: { location: 'C12', quantity: 7 }, b148_alternative: { location: 'D05', quantity: 4 }, seeded_action: { id: 'ACT-SCAN-B184', component: 'B184', reversible: true } }, 'SYSTEM');
  });
  reset();
  return res.json({ ok: true });
});

apiRouter.get('/state', (req, res) => {
  if (req.header('X-VoiceStrike-Verification') === 'post-mutation') {
    if (injectedFailure(res, 'VERIFY_TIMEOUT')) return;
    if (injectedFailure(res, 'VERIFY_BEFORE')) return;
  }
  const state = getDashboardState();
  if (!state.job) return res.status(404).json({ error: 'Demo job not found' });
  res.setHeader('Cache-Control', 'no-store');
  return res.json(state);
});

apiRouter.get('/jobs/current', (_req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(CURRENT_JOB_ID);
  if (!job) return res.status(404).json({ error: 'No current job' });
  return res.json(job);
});

apiRouter.get('/inventory', (_req, res) => {
  return res.json(db.prepare('SELECT * FROM inventory ORDER BY component').all());
});
