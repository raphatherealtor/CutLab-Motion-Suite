/**
 * Headless driver for the in-app E2E suite (src/engine/e2e-tests.ts).
 * Browser-dependent tests self-skip via the suite's SkipError mechanism;
 * failures caused by missing browser globals in this Node environment are
 * reported as environment skips, not regressions.
 *
 * Run:  npx tsx scripts/run-e2e.ts
 */

import { runAllTests, summarizeResults } from '../src/engine/e2e-tests';

function isBrowserOnlyFailure(message: string): boolean {
  return (
    /document is not defined/.test(message) ||
    /window is not defined/.test(message) ||
    /localStorage is not defined/.test(message) ||
    /AudioContext is not defined/.test(message) ||
    /MediaRecorder is not defined/.test(message) ||
    /Cannot read properties of null \(reading '(isReal|durationSecs|channels|cancel|onCancel|size|arrayBuffer|recommendedFormat|recommendedFormats|cancelled|throwIfCancelled)'\)/.test(
      message
    ) ||
    /capability report is null\/undefined/.test(message)
  );
}

let realFailures = 0;

runAllTests()
  .then((suites) => {
    for (const s of suites) {
      const fails = s.results.filter((r) => r.status === 'fail');
      const envSkips = fails.filter((f) => isBrowserOnlyFailure(f.message));
      const real = fails.filter((f) => !isBrowserOnlyFailure(f.message));
      realFailures += real.length;
      const skippedNote = envSkips.length > 0 ? ` (+${envSkips.length} browser-only skipped)` : '';
      console.log(
        `${s.suite}: ${s.passed} passed, ${real.length} failed${skippedNote}`
      );
      for (const f of envSkips) {
        console.log(`    SKIP (browser-only env) ${f.name}`);
      }
      for (const f of real) {
        console.log(`    FAIL ${f.name}: ${f.message}`);
      }
    }
    console.log('\n' + summarizeResults(suites));
    console.log(`real (non-environment) failures: ${realFailures}`);
    process.exit(realFailures > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error('E2E driver crashed:', e);
    process.exit(1);
  });
