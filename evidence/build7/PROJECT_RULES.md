# VoiceStrike — Permanent Reliability Rules

## Rule R7-FALSE-TRANSCRIPT

**False transcript may happen. False mutation must not.**

This is a permanent VoiceStrike architecture rule.

Consequences:

1. A speech transcript is evidence, never authority by itself.
2. A false or contaminated transcript must never be sufficient to mutate operational state.
3. Protected critical speech must pass deterministic trust gates before it can become command authority.
4. A critical confirmation requires fresh speech onset, wake authority, a post-TTS quiet gap, exact entity binding, and the correct prepared-action context.
5. Critical speech that fails trust is silently rejected before pending-command acceptance; it cannot create confirmation authority or call a mutation tool.
6. Mutation success still requires independent authoritative verification before VoiceStrike may claim success.
7. No implementation may invent a confidence signal that the live speech provider does not expose. If provider confidence is unavailable at the live event, VoiceStrike must use observable trust signals and treat uncertainty conservatively.

This rule strengthens, and does not replace, the existing project rules:

- **Speech is input, not authority.**
- **Speech content alone never proves speaker authority.**
- **LLM interprets. Code authorises.**
- **Mutation success ≠ verification success.**
