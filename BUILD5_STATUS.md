# VoiceStrike — BUILD 5 Status

## BUILD 5 — Missing Inventory

**Version:** 0.6.0  
**Target:** Worker reports that the system location for the required component is empty. VoiceStrike verifies the system record, logs a discrepancy, marks the primary location operationally unavailable, finds alternative stock, and pushes the change live to Supervisor.

### Deterministic workflow
1. `get_current_job()` → authoritative expected component.
2. `check_inventory(B148)` → authoritative primary location `C12`, system quantity `7`.
3. Worker explicitly reports that exact location is empty.
4. `report_inventory_discrepancy(B148, C12, EMPTY)` is authorised only when a recent positive system-stock check exists for that exact component/location.
5. Code creates `INVENTORY_DISCREPANCY` and changes operational quantity at `C12` to `0`.
6. `find_alternative_inventory(B148)` → deterministic alternative `D05`, quantity `4`.
7. SSE pushes the new exception, inventory state, alternative stock, and audit evidence to Supervisor.

### Safety / authority
- Speech is input, not authority.
- LLM interprets. Code authorises.
- The system does not claim independent physical verification. The exception is explicitly a worker-reported discrepancy.
- A bare confirmation cannot mark inventory empty.
- Wrong component workflow from BUILD 3/4 remains available.

### Exit criteria
- Missing-inventory voice workflow succeeds.
- Primary B148/C12 changes from 7 → 0 only after deterministic gate.
- `INVENTORY_DISCREPANCY` appears in Supervisor live state.
- Alternative B148 at D05 / qty 4 is returned and visible.
- Audit contains CHECK_INVENTORY → REPORT_INVENTORY_DISCREPANCY → FIND_ALTERNATIVE_INVENTORY.
- Reset restores B148/C12 qty 7 and removes exceptions.
