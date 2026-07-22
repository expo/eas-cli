import { test, expect } from 'bun:test';

import { renderMarkdown, parseEmbeddedFingerprints } from '../core/render.js';
import type { CoordinatorOutput, Finding } from '../core/schema.js';

const base: CoordinatorOutput = { decision: 'approve', findings: [], summary: 'ok', incomplete: [] };
const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'warning',
  category: 'quality',
  file: 'a.ts',
  line: 1,
  title: 'T',
  rationale: 'r',
  ...over,
});

test('parseEmbeddedFingerprints round-trips even with a regex-metachar comment tag', () => {
  const tag = 'expo.ai+review(x)'; // contains . + ( ) — must be escaped in the parser
  const body = renderMarkdown({ ...base, findings: [finding()] }, tag);
  expect(parseEmbeddedFingerprints(body, tag).length).toBe(1);
});

test('coverage note only renders when incomplete is non-empty (no more wolf-crying)', () => {
  expect(renderMarkdown(base, 'tag')).not.toContain('Coverage note');
  expect(renderMarkdown({ ...base, incomplete: ['a pass timed out'] }, 'tag')).toContain('Coverage note');
});

test('renders per-severity headers with counts', () => {
  const out = renderMarkdown(
    {
      ...base,
      decision: 'request_changes',
      findings: [
        finding({ severity: 'critical', category: 'security', title: 'C' }),
        finding({ severity: 'warning', title: 'W' }),
      ],
    },
    'tag'
  );
  expect(out).toMatch(/Critical \(1\)/i);
  expect(out).toMatch(/Warning \(1\)/i);
});
