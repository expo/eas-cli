import { test, expect } from 'bun:test';

import { extractJsonObject, fingerprintFinding } from '../core/schema.js';
import type { Finding } from '../core/schema.js';

test('extractJsonObject: fenced ```json block', () => {
  expect(extractJsonObject('prose\n```json\n{"a":1}\n```\nmore')).toEqual({ a: 1 });
});

test('extractJsonObject: outermost-brace fallback', () => {
  expect(extractJsonObject('here it is: {"a":2} done')).toEqual({ a: 2 });
});

test('extractJsonObject: throws on non-JSON', () => {
  expect(() => extractJsonObject('no json at all')).toThrow();
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'warning',
  category: 'quality',
  file: 'a.ts',
  line: 1,
  title: 'Title',
  rationale: 'r',
  ...over,
});

test('fingerprint is line-independent and stable', () => {
  expect(fingerprintFinding(finding({ line: 1 }))).toBe(fingerprintFinding(finding({ line: 99 })));
});

test('fingerprint (evidence-less) falls back to title', () => {
  expect(fingerprintFinding(finding({ title: 'A' }))).not.toBe(fingerprintFinding(finding({ title: 'B' })));
  expect(fingerprintFinding(finding({ file: 'a.ts' }))).not.toBe(fingerprintFinding(finding({ file: 'b.ts' })));
});

test('fingerprint v2: keys on evidence, not the (nondeterministic) title', () => {
  const a = finding({ title: 'Null deref here', evidence: 'return items[next++]!;' });
  const b = finding({ title: 'Possible null dereference', evidence: 'return items[next++]!;' });
  // Same code, different LLM wording → same fingerprint (so a dismissal is stable).
  expect(fingerprintFinding(a)).toBe(fingerprintFinding(b));
  // Different code → different fingerprint (dismissal lapses when the code changes).
  const c = finding({ title: 'Null deref here', evidence: 'const totally = different();' });
  expect(fingerprintFinding(a)).not.toBe(fingerprintFinding(c));
});
