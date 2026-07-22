import { test, expect } from 'bun:test';

import {
  chunkByLines,
  applyReviewPolicy,
  runGrowableQueue,
  decisionAfterVerification,
} from '../core/review.js';
import type { PatchWorkspaceFile } from '../core/noise.js';
import type { CoordinatorOutput, Finding } from '../core/schema.js';

const wf = (p: string, changedLines: number): PatchWorkspaceFile => ({
  path: p,
  patchPath: '/x',
  status: 'M',
  patch: '',
  changedLines,
});
const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'warning',
  category: 'quality',
  file: 'a.ts',
  line: 1,
  title: 'T',
  rationale: 'r',
  ...over,
});

test('chunkByLines: splits by maxChangedLines', () => {
  const chunks = chunkByLines([wf('a', 600), wf('b', 600), wf('c', 600)], 1000, 20);
  expect(chunks.map(c => c.map(f => f.path))).toEqual([['a'], ['b'], ['c']]);
});

test('chunkByLines: caps by maxFiles', () => {
  const files = Array.from({ length: 25 }, (_, i) => wf(`f${i}`, 1));
  const chunks = chunkByLines(files, 10_000, 20);
  expect(chunks.length).toBe(2);
  expect(chunks[0]!.length).toBe(20);
  expect(chunks[1]!.length).toBe(5);
});

test('chunkByLines: a single over-budget file is its own chunk', () => {
  const chunks = chunkByLines([wf('big', 5000), wf('small', 10)], 1000, 20);
  expect(chunks.map(c => c.map(f => f.path))).toEqual([['big'], ['small']]);
});

test('applyReviewPolicy: drops suggestions, sorts by severity', () => {
  const out: CoordinatorOutput = {
    decision: 'request_changes',
    findings: [finding({ severity: 'suggestion' }), finding({ severity: 'warning' }), finding({ severity: 'critical' })],
    summary: 's',
    incomplete: [],
  };
  const result = applyReviewPolicy(out, { includeSuggestions: false });
  expect(result.findings.map(f => f.severity)).toEqual(['critical', 'warning']);
});

test('applyReviewPolicy: approve_with_comments + no findings → approve', () => {
  const result = applyReviewPolicy(
    { decision: 'approve_with_comments', findings: [], summary: '', incomplete: [] },
    { includeSuggestions: false }
  );
  expect(result.decision).toBe('approve');
});

test('runGrowableQueue: runs every ELEMENT once, bounded (guards the index-vs-element FP)', async () => {
  const seen: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  await runGrowableQueue([1, 2, 3, 4, 5], 2, async n => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    seen.push(n);
    inFlight--;
  });
  expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]); // the values, not indices 0..4
  expect(maxInFlight).toBeLessThanOrEqual(2);
});

test('runGrowableQueue: processes items enqueued DURING the run (subdivision), still bounded', async () => {
  const seen: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  await runGrowableQueue([1, 2, 3], 2, async (n, enqueue) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    seen.push(n);
    // Item 3 "times out" and subdivides into two smaller units mid-run.
    if (n === 3) {
      enqueue(30);
      enqueue(31);
    }
    inFlight--;
  });
  expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 30, 31]);
  expect(maxInFlight).toBeLessThanOrEqual(2);
});

test('decisionAfterVerification: re-derives after drops', () => {
  expect(decisionAfterVerification('request_changes', [])).toBe('approve');
  expect(decisionAfterVerification('request_changes', [finding({ severity: 'warning' })])).toBe(
    'approve_with_comments'
  );
  expect(decisionAfterVerification('request_changes', [finding({ severity: 'critical' })])).toBe(
    'request_changes'
  );
});
