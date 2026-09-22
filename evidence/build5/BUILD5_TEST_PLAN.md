# BUILD 5 Test Plan — Missing Inventory

## Happy path
1. Reset demo state.
2. Start VoiceStrike.
3. Say: **"The B148 location C12 is empty."**
4. Expected voice/tool flow: current job if needed → check inventory → report discrepancy → find alternative.
5. Expected spoken result: discrepancy logged; C12 marked unavailable; B148 available at D05, quantity 4.
6. Supervisor must update without refresh.

## Evidence expected
- `TOOL_CHECK_INVENTORY` shows B148/C12/7/available true before mutation.
- `TOOL_REPORT_INVENTORY_DISCREPANCY` shows C12 quantity 0 and open exception.
- `TOOL_FIND_ALTERNATIVE_INVENTORY` shows D05 quantity 4.

## Safety negative test
Ask VoiceStrike to mark A07 empty for B148 or call discrepancy without checking system stock first. Code must reject the mutation.
