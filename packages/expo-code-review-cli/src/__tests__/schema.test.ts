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

test('fingerprint differs by file / category / title', () => {
  expect(fingerprintFinding(finding({ title: 'A' }))).not.toBe(fingerprintFinding(finding({ title: 'B' })));
  expect(fingerprintFinding(finding({ file: 'a.ts' }))).not.toBe(fingerprintFinding(finding({ file: 'b.ts' })));
});
