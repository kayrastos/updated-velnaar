import { describe, expect, it, vi } from 'vitest';
import {
  advanceOrchestration as advance, startOrchestration as start, sha256,
  runOrchestration, fallbackEligible, NO_AUTO_ACTION, BOUNDS,
  type Session, type Candidate,
} from '../../../scripts/fulgor/orchestration/orchestrator';

const baseline = 'a'.repeat(40);
const candidate: Candidate = { baseline, path: 'tests/new.test.ts', status: '??',
  kind: 'regular', content: 'test evidence', contentSha256: sha256('test evidence'),
  trackedPatch: '', admission: 'WHITE' };
function output(s: Session, disposition: string, extra = {}) {
  const stages = { AWAITING_SCOUT: 'SCOUT', AWAITING_CODEX: 'CODEX',
    FALLBACK_ELIGIBLE: 'ANTIGRAVITY', AWAITING_REVIEWER: 'REVIEWER' };
  return JSON.stringify({ schemaVersion: s.schemaVersion, requestId: s.requestId,
    stage: stages[s.state], artifactSha256: s.candidate ? sha256(JSON.stringify(s.candidate)) : sha256(s.baseline),
    disposition, failure: null, candidate: null, ...extra });
}
function builder() { const s = start('request', baseline); return advance(s, output(s, 'FINDINGS')); }
function reviewer() { const s = builder(); return advance(s, output(s, 'CANDIDATE', { candidate })); }

describe('bounded orchestration foundation', () => {
  it('runs the normal path once in order and stops before FULGOR', () => {
    const calls: string[] = [];
    const fallback = vi.fn();
    const result = runOrchestration('request', baseline, {
      scout: s => { calls.push('scout'); return output(s, 'FINDINGS'); },
      codex: s => { calls.push('codex'); return output(s, 'CANDIDATE', { candidate }); },
      antigravity: fallback,
      reviewer: s => { calls.push('reviewer'); return output(s, 'PASS'); },
    });
    expect(calls).toEqual(['scout', 'codex', 'reviewer']);
    expect(fallback).not.toHaveBeenCalled();
    expect(result.state).toBe('FULGOR_HANDOFF_ELIGIBLE');
    expect(result.policy).toEqual(NO_AUTO_ACTION);
    expect(result.policy.humanApprovalRequired).toBe(true);
    expect(result.policy.automaticPromotionAllowed).toBe(false);
  });
  it.each(['TIMEOUT', 'OUTPUT_LIMIT', 'MALFORMED_RESPONSE'])('permits a single bounded fallback for %s', failure => {
    let s = builder();
    s = advance(s, output(s, 'FAILED', { failure }));
    expect(s.state).toBe('FALLBACK_ELIGIBLE');
    s = advance(s, output(s, 'FAILED', { failure }));
    expect(s.state).toBe('NEEDS_REVIEW');
  });
  it('runs successful fallback then reviewer within four stages', () => {
    const result = runOrchestration('request', baseline, {
      scout: s => output(s, 'FINDINGS'),
      codex: s => output(s, 'FAILED', { failure: 'TIMEOUT' }),
      antigravity: s => output(s, 'CANDIDATE', { candidate }),
      reviewer: s => output(s, 'NO_BLOCKERS'),
    });
    expect(result.state).toBe('FULGOR_HANDOFF_ELIGIBLE');
    expect(result.evidence.map(e => e.stage)).toEqual(['SCOUT', 'CODEX', 'ANTIGRAVITY', 'REVIEWER']);
  });
  it.each(['AUTHORIZATION_FAILURE', 'SECURITY_POLICY_FAILURE', 'FORBIDDEN_SCOPE', 'REFUSAL', 'PRODUCTION_BOUNDARY', 'NON_ZERO_EXIT', 'SPAWN_FAILURE', 'INVALID_CONFIG', 'PROCESS_FAILURE', 'unknown'])('denies fallback for %s', failure => {
    const s = builder();
    expect(fallbackEligible(failure)).toBe(false);
    expect(advance(s, output(s, 'FAILED', { failure })).state).toBe('NEEDS_REVIEW');
  });
  it.each(['PASS', 'FINDINGS'])('valid advisory %s permits handoff without granting authority', verdict => {
    const s = reviewer(); const response = output(s, verdict);
    const result = advance(s, response);
    expect(result.state).toBe('FULGOR_HANDOFF_ELIGIBLE');
    expect(result.evidence.at(-1)).toEqual({ stage: 'REVIEWER', responseSha256: sha256(response) });
    expect(result.policy).toBe(NO_AUTO_ACTION);
  });
  it.each(['{', '{}', 'null', '[]'])('fails closed on malformed reviewer output %s', response => {
    expect(advance(reviewer(), response).state).toBe('NEEDS_REVIEW');
  });
  it('rejects extra keys, wrong identity, hash and stage', () => {
    const s = reviewer();
    for (const extra of [{ authority: true }, { requestId: 'other' }, { artifactSha256: '0'.repeat(64) }, { stage: 'CODEX' }]) {
      expect(advance(s, output(s, 'PASS', extra)).state).toBe('NEEDS_REVIEW');
    }
  });
  it.each([
    { path: 'src/production.ts' }, { trackedPatch: 'production diff' },
    { path: 'tests/../production.ts' }, { path: 'tests/a\0.ts' },
    { kind: 'symlink' }, { baseline: 'b'.repeat(40) }, { admission: 'BLACK' },
    { contentSha256: '0'.repeat(64) }, { content: 'x'.repeat(BOUNDS.maxContentBytes + 1) },
    { paths: ['tests/a.ts', 'tests/b.ts'] },
  ])('explicitly rejects unsupported candidate %j', change => {
    const s = builder();
    expect(advance(s, output(s, 'CANDIDATE', { candidate: { ...candidate, ...change } })).state).toBe('UNSUPPORTED_HANDOFF');
  });
  it('blocks explicit blocker without fallback and preserves policy', () => {
    const s = reviewer();
    const blocked = advance(s, output(s, 'BLOCKED'));
    expect(blocked.state).toBe('NEEDS_REVIEW');
    expect(blocked.policy).toBe(NO_AUTO_ACTION);
    expect(advance(blocked, output(s, 'PASS')).state).toBe('NEEDS_REVIEW');
    expect(Object.values(NO_AUTO_ACTION).filter(v => v === true)).toEqual([true]);
    expect(Object.isFrozen(blocked)).toBe(true);
    expect(Object.isFrozen(blocked.evidence)).toBe(true);
    expect(Object.isFrozen(blocked.candidate)).toBe(true);
  });
  it('rejects forged/persisted states and invalid start identity', () => {
    expect(() => advance({ ...builder(), state: 'AWAITING_REVIEWER' }, '{}')).toThrow('INVALID_ORCHESTRATION_STATE');
    expect(() => start('request', 'HEAD')).toThrow();
    expect(() => advance(null, '{}')).toThrow();
  });
  it('fails closed on oversized output, thrown adapters and unknown dispositions', () => {
    expect(advance(builder(), ' '.repeat(BOUNDS.maxResponseBytes + 1)).state).toBe('NEEDS_REVIEW');
    const s = reviewer();
    expect(advance(s, output(s, 'AUTHORITATIVE_PASS')).state).toBe('NEEDS_REVIEW');
    const codex = vi.fn();
    expect(runOrchestration('request', baseline, { scout: () => { throw Error(); }, codex, reviewer: () => '' }).state).toBe('NEEDS_REVIEW');
    expect(codex).not.toHaveBeenCalled();
  });
});
