# BUILD 7 — Windows validation

Recommended location: `C:\VoiceStrikeDev`.

## Preferred: Safe Launcher

Place the Safe Launcher files in `C:\VoiceStrikeDev` beside the extracted build folder and run:

```text
START_VOICESTRIKE.bat
```

For a new build the launcher installs dependencies, runs the production build, structural validation and reliability-core suite, then starts VoiceStrike only if all gates pass.

## Manual equivalent

From `voicestrike-build7` in PowerShell or Command Prompt:

```text
npm install
npm run build
npm run validate:build7
npm run test:reliability-core
npm run dev
```

Expected v0.8.10 automated gates:

1. production build PASS;
2. `validate:build7` → **162/162 PASS**;
3. `test:reliability-core` → **200/200 PASS**.

No `ExecutionPolicy Bypass`, antivirus exclusion, or hidden process is required.

Reset demo state before each end-to-end workflow and follow `evidence/build7/BUILD7_TEST_PLAN.md`, especially R16, R17 and the v0.8.10 view-persistence regression R18.

For failure injection, enable it only in a separate test session:

```powershell
$env:VOICESTRIKE_ENABLE_RELIABILITY_FAULTS='true'
npm run dev
```

Do not enable fault injection for the normal demo/submission run.
