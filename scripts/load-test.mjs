#!/usr/bin/env node
// Minimal, dependency-free load test. No k6/autocannon install needed --
// just Node's built-in fetch and Promise concurrency.
//
// Usage:
//   node scripts/load-test.mjs [url] [concurrency] [totalRequests]
//   node scripts/load-test.mjs http://localhost:3000 20 200
//
// What this can and can't tell you right now:
// - It CAN hammer any plain HTTP endpoint (the static frontend, a health
//   check, an onRequest Cloud Function) and report latency/success rate.
// - It CANNOT meaningfully load-test the onCall functions in
//   functions/src/index.ts as-is, because every one of them requires a real
//   Firebase Auth ID token (see requireAuth() in that file) -- there's no
//   valid token to attach without real signed-in users. Once Email/Password
//   sign-in is enabled on the live project, extend this script:
//     1. POST to https://identitytoolkit.googleapis.com/v1/accounts:signUp
//        (with the public apiKey from firebase-applet-config.json) to mint
//        N throwaway test users and grab their idToken.
//     2. Call the callable functions' real HTTPS endpoint
//        (https://<region>-<project>.cloudfunctions.net/<name>) with
//        `Authorization: Bearer <idToken>` and the callable wire format:
//        POST body `{"data": {...}}`, and expect `{"result": {...}}` back.
//     3. Watch functions/src/index.ts's DAILY_LIMITS -- a real load test
//        WILL trip the per-user rate limiter by design; that's a pass, not
//        a failure, unless you're specifically trying to raise the limit.

const [, , targetUrl = 'http://localhost:3000', concurrencyArg = '10', totalArg = '100'] = process.argv;
const concurrency = parseInt(concurrencyArg, 10);
const total = parseInt(totalArg, 10);

const results = [];

async function fire(i) {
  const start = performance.now();
  try {
    const res = await fetch(targetUrl, { method: 'GET' });
    const elapsed = performance.now() - start;
    results.push({ i, ok: res.ok, status: res.status, ms: elapsed });
  } catch (err) {
    const elapsed = performance.now() - start;
    results.push({ i, ok: false, status: 0, ms: elapsed, error: err.message });
  }
}

async function run() {
  console.log(`Load testing ${targetUrl} -- ${total} requests, concurrency ${concurrency}\n`);
  let inFlight = 0;
  let launched = 0;

  await new Promise((resolve) => {
    const launchNext = () => {
      if (launched >= total) {
        if (inFlight === 0) resolve();
        return;
      }
      launched++;
      inFlight++;
      fire(launched).finally(() => {
        inFlight--;
        launchNext();
        if (launched >= total && inFlight === 0) resolve();
      });
    };
    for (let c = 0; c < Math.min(concurrency, total); c++) launchNext();
  });

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const p99 = times[Math.floor(times.length * 0.99)] || 0;
  const avg = times.reduce((a, b) => a + b, 0) / (times.length || 1);

  console.log(`Results:`);
  console.log(`  Success: ${ok}/${results.length} (${((ok / results.length) * 100).toFixed(1)}%)`);
  if (failed > 0) {
    console.log(`  Failed:  ${failed}`);
    const sampleErrors = results.filter((r) => !r.ok).slice(0, 3);
    sampleErrors.forEach((r) => console.log(`    - request #${r.i}: status ${r.status}${r.error ? ` (${r.error})` : ''}`));
  }
  console.log(`  Latency: avg ${avg.toFixed(0)}ms, p50 ${p50.toFixed(0)}ms, p95 ${p95.toFixed(0)}ms, p99 ${p99.toFixed(0)}ms`);
}

run();
