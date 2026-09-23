import { CommandRegistry } from '../client/src/reliability/commands.ts';
import { assessReadReadiness } from '../client/src/reliability/toolPolicy.ts';

let passed = 0;
let failed = 0;

function check(condition: unknown, label: string, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail === undefined ? '' : `  got=${JSON.stringify(detail)}`}`);
  }
}

const registry = new CommandRegistry();

const initial = registry.acceptFinalTranscript("VoiceStrike's location for B148 is empty.");
check(initial.workflow === 'E2_MISSING_INVENTORY', 'VS-007 initial utterance owns E2', initial.workflow);
check(initial.slots.component === 'B148', 'VS-007 initial utterance preserves component B148', initial.slots);
check(initial.slots.observedEmpty === true, 'VS-007 initial utterance preserves EMPTY observation', initial.slots);
check(initial.pendingClarification?.field === 'reportedLocation', 'VS-007 asks only for missing reportedLocation', initial.pendingClarification);

const clarified = registry.acceptFinalTranscript('C12.');
check(clarified.id === initial.id, 'VS-007 short location clarification stays on same commandId', { initial: initial.id, clarified: clarified.id });
check(clarified.slots.reportedLocation === 'C12', 'VS-007 standalone C12 fills typed location slot', clarified.slots);
check(clarified.slots.component === 'B148' && clarified.slots.observedEmpty === true, 'VS-007 clarification preserves existing component and EMPTY slots', clarified.slots);
check(clarified.status === 'READY' && clarified.pendingClarification === undefined, 'VS-007 command becomes READY after C12', { status: clarified.status, pending: clarified.pendingClarification });

const args = registry.bindToolArguments(clarified.id, 'check_inventory', { component_id: 'C12' });
check(args.component_id === 'B148', 'VS-007 check_inventory is rebound to trusted component B148', args);

const readiness = assessReadReadiness({
  toolName: 'check_inventory',
  args,
  commandReady: registry.isReady(clarified.id),
  workflow: clarified.workflow,
  trustedComponent: registry.trustedComponentForTool(clarified.id, 'check_inventory'),
  pendingEntityConfirmation: null,
});
check(readiness.ok, 'VS-007 check_inventory passes readiness after location clarification', readiness);

console.log(`\nVS-007 E2 location clarification regression: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
