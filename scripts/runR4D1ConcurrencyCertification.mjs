/**
 * @file scripts/runR4D1ConcurrencyCertification.mjs
 * @description Local concurrency client runner for Phase A.12B.2C-5U.3.4C.
 *
 * SAFETY INVARIANTS:
 * - Sends synthetic coordinates (mode, round, contender) ONLY.
 * - ZERO retries, ZERO exponential backoff, ZERO second attempts.
 * - Strict concurrent dispatch: all 32 promises launched simultaneously per round.
 * - Fail-closed immediately on any non-qualifying response.
 */

import { performance } from 'node:perf_hooks';

/**
 * Runs a single round of 32 concurrent requests.
 */
async function executeRound(workerUrl, token, mode, round) {
  const endpoint = `${workerUrl.replace(/\/+$/, '')}/r4/reserve`;
  const promises = [];

  const roundStartTime = performance.now();

  for (let contender = 1; contender <= 32; contender++) {
    const body = JSON.stringify({ mode, round, contender });
    const p = (async () => {
      const initTime = performance.now() - roundStartTime;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body,
        });

        const elapsedMs = performance.now() - roundStartTime - initTime;

        if (res.status !== 200) {
          const errText = await res.text().catch(() => '');
          return {
            contender,
            httpStatus: res.status,
            ok: false,
            error: `HTTP_${res.status}: ${errText.slice(0, 100)}`,
            elapsedMs,
          };
        }

        const data = await res.json();
        return {
          contender,
          httpStatus: 200,
          ok: true,
          status: data.status,
          colo: data.colo || 'UNKNOWN',
          elapsedMs,
        };
      } catch (err) {
        const elapsedMs = performance.now() - roundStartTime - initTime;
        return {
          contender,
          httpStatus: 0,
          ok: false,
          error: `NETWORK_ERROR: ${err.message}`,
          elapsedMs,
        };
      }
    })();
    promises.push(p);
  }

  const results = await Promise.all(promises);
  const roundDurationMs = performance.now() - roundStartTime;

  let reservedCount = 0;
  let alreadyReservedCount = 0;
  let backendUnavailableCount = 0;
  let invalidRequestCount = 0;
  let errorCount = 0;
  const colos = new Set();

  for (const r of results) {
    if (!r.ok) {
      errorCount++;
      continue;
    }
    if (r.colo) colos.add(r.colo);
    if (r.status === 'RESERVED') reservedCount++;
    else if (r.status === 'ALREADY_RESERVED') alreadyReservedCount++;
    else if (r.status === 'BACKEND_UNAVAILABLE') backendUnavailableCount++;
    else if (r.status === 'INVALID_REQUEST') invalidRequestCount++;
    else errorCount++;
  }

  return {
    round,
    mode,
    roundDurationMs,
    total: results.length,
    reserved: reservedCount,
    alreadyReserved: alreadyReservedCount,
    backendUnavailable: backendUnavailableCount,
    invalidRequest: invalidRequestCount,
    errors: errorCount,
    colos: Array.from(colos),
    contenders: results,
  };
}

/**
 * Main execution coordinator.
 */
export async function runCertification(workerUrl, token) {
  if (!workerUrl || !token) {
    throw new Error('MISSING_PARAMETERS: workerUrl and token are required');
  }

  console.log(`[R4-RUNNER] Starting Bounded Concurrency Certification against ${workerUrl}`);
  console.log('[R4-RUNNER] Matrix: 20 contested rounds x 32 requests, 20 control rounds x 32 requests (1280 total)');

  const observedColos = new Set();
  const contestedRounds = [];
  const controlRounds = [];

  let totalAttempts = 0;
  let totalReserved = 0;
  let totalAlreadyReserved = 0;
  let totalBackendUnavailable = 0;
  let totalInvalidRequest = 0;
  let totalErrors = 0;

  // 1. CONTESTED MATRIX
  console.log('\n[R4-RUNNER] --- PHASE 1: CONTESTED MATRIX (20 rounds x 32 requests) ---');
  for (let round = 1; round <= 20; round++) {
    const summary = await executeRound(workerUrl, token, 'contested', round);
    summary.colos.forEach(c => observedColos.add(c));
    contestedRounds.push(summary);

    totalAttempts += summary.total;
    totalReserved += summary.reserved;
    totalAlreadyReserved += summary.alreadyReserved;
    totalBackendUnavailable += summary.backendUnavailable;
    totalInvalidRequest += summary.invalidRequest;
    totalErrors += summary.errors;

    console.log(
      `[R4-RUNNER] Contested Round ${String(round).padStart(2, '0')}/20: ` +
      `RESERVED=${summary.reserved}, ALREADY_RESERVED=${summary.alreadyReserved}, ` +
      `errors=${summary.errors} (${summary.roundDurationMs.toFixed(1)}ms, colos: ${summary.colos.join(',') || 'none'})`
    );

    // Fail-closed invariant check: Exactly 1 RESERVED and 31 ALREADY_RESERVED
    if (
      summary.reserved !== 1 ||
      summary.alreadyReserved !== 31 ||
      summary.errors !== 0 ||
      summary.backendUnavailable !== 0 ||
      summary.invalidRequest !== 0
    ) {
      console.error(`[R4-RUNNER] FAIL: Contested round ${round} did not meet acceptance criteria!`);
      return {
        success: false,
        failureReason: 'R4_CONTESTED_CONCURRENCY_CERTIFICATION_FAILED',
        failedRound: round,
        totalAttempts,
        totalReserved,
        totalAlreadyReserved,
        totalBackendUnavailable,
        totalInvalidRequest,
        totalErrors,
        contestedRounds,
        controlRounds,
        observedColos: Array.from(observedColos),
      };
    }
  }

  // 2. CONTROL MATRIX
  console.log('\n[R4-RUNNER] --- PHASE 2: CONTROL MATRIX (20 rounds x 32 requests) ---');
  for (let round = 1; round <= 20; round++) {
    const summary = await executeRound(workerUrl, token, 'control', round);
    summary.colos.forEach(c => observedColos.add(c));
    controlRounds.push(summary);

    totalAttempts += summary.total;
    totalReserved += summary.reserved;
    totalAlreadyReserved += summary.alreadyReserved;
    totalBackendUnavailable += summary.backendUnavailable;
    totalInvalidRequest += summary.invalidRequest;
    totalErrors += summary.errors;

    console.log(
      `[R4-RUNNER] Control Round ${String(round).padStart(2, '0')}/20: ` +
      `RESERVED=${summary.reserved}, ALREADY_RESERVED=${summary.alreadyReserved}, ` +
      `errors=${summary.errors} (${summary.roundDurationMs.toFixed(1)}ms, colos: ${summary.colos.join(',') || 'none'})`
    );

    // Fail-closed invariant check: Exactly 32 RESERVED and 0 ALREADY_RESERVED
    if (
      summary.reserved !== 32 ||
      summary.alreadyReserved !== 0 ||
      summary.errors !== 0 ||
      summary.backendUnavailable !== 0 ||
      summary.invalidRequest !== 0
    ) {
      console.error(`[R4-RUNNER] FAIL: Control round ${round} did not meet acceptance criteria!`);
      return {
        success: false,
        failureReason: 'R4_CONTROL_CONCURRENCY_CERTIFICATION_FAILED',
        failedRound: round,
        totalAttempts,
        totalReserved,
        totalAlreadyReserved,
        totalBackendUnavailable,
        totalInvalidRequest,
        totalErrors,
        contestedRounds,
        controlRounds,
        observedColos: Array.from(observedColos),
      };
    }
  }

  // 3. FINAL ACCEPTANCE
  const colosArray = Array.from(observedColos);
  const multiGeoObserved = colosArray.length >= 2;

  const passed =
    totalAttempts === 1280 &&
    totalReserved === 660 &&
    totalAlreadyReserved === 620 &&
    totalBackendUnavailable === 0 &&
    totalInvalidRequest === 0 &&
    totalErrors === 0;

  return {
    success: passed,
    totalAttempts,
    contestedAttempts: 640,
    controlAttempts: 640,
    totalReserved,
    contestedReserved: 20,
    controlReserved: 640,
    totalAlreadyReserved,
    totalBackendUnavailable,
    totalInvalidRequest,
    totalErrors,
    retries: 0,
    contestedRounds,
    controlRounds,
    observedColos: colosArray,
    multiGeoObserved,
  };
}

// Standalone CLI execution
if (process.argv[1] && process.argv[1].endsWith('runR4D1ConcurrencyCertification.mjs')) {
  const workerUrl = process.env.R4_WORKER_URL || process.argv[2];
  const token = process.env.R4_CERT_TOKEN || process.argv[3];
  runCertification(workerUrl, token).then(res => {
    console.log('\n[R4-RUNNER] Execution result:', JSON.stringify({
      success: res.success,
      totalAttempts: res.totalAttempts,
      totalReserved: res.totalReserved,
      totalAlreadyReserved: res.totalAlreadyReserved,
      totalErrors: res.totalErrors,
      colos: res.observedColos,
      multiGeo: res.multiGeoObserved
    }, null, 2));
    if (!res.success) process.exit(1);
  }).catch(err => {
    console.error('[R4-RUNNER] Fatal runner error:', err);
    process.exit(1);
  });
}
