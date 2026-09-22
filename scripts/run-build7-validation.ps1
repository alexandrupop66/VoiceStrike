$ErrorActionPreference = 'Stop'

Write-Host 'VoiceStrike BUILD 7 — validation' -ForegroundColor Cyan
Write-Host '1/4 Installing dependencies...'
npm install

Write-Host '2/4 Structural validation...'
npm run validate:build7

Write-Host '3/4 Production build...'
npm run build

Write-Host '4/4 Reliability core tests...'
npm run test:reliability-core

Write-Host ''
Write-Host 'BUILD 7 automated gates PASS.' -ForegroundColor Green
Write-Host 'Next: run the Windows/runtime voice tests in evidence/build7/BUILD7_TEST_PLAN.md.'
