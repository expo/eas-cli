import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applyInlineIgnores } from '../core/suppress.js';
import type { Finding } from '../core/schema.js';

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ecr-suppress-test-'));
  file = path.join(dir, 's.ts');
  writeFileSync(
    file,
    [
      'const a = 1;', // 1
      'const b = evil(); // expo-code-review-ignore: known', // 2 — directive on the line
      '// expo-code-review-ignore: above', // 3
      'const c = alsoEvil();', // 4 — directive on the line above
      'const d = plain();', // 5 — no directive
    ].join('\n')
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const finding = (over: Partial<Finding>): Finding => ({
  severity: 'warning',
  category: 'quality',
  file,
  line: 1,
  title: 'T',
  rationale: 'r',
  ...over,
});

test('suppresses a warning with the directive on its line', async () => {
  const res = await applyInlineIgnores([finding({ line: 2, title: 'on-line' })], '/');
  expect(res.suppressed.map(f => f.title)).toEqual(['on-line']);
  expect(res.kept).toEqual([]);
});

test('suppresses a warning with the directive on the line above', async () => {
  const res = await applyInlineIgnores([finding({ line: 4, title: 'above' })], '/');
  expect(res.suppressed.map(f => f.title)).toEqual(['above']);
});

test('keeps a warning with no directive nearby', async () => {
  const res = await applyInlineIgnores([finding({ line: 5, title: 'plain' })], '/');
  expect(res.kept.map(f => f.title)).toEqual(['plain']);
  expect(res.suppressed).toEqual([]);
});

test('carve-out: NEVER suppresses a critical, even with a directive', async () => {
  const res = await applyInlineIgnores([finding({ line: 2, severity: 'critical', title: 'crit' })], '/');
  expect(res.kept.map(f => f.title)).toEqual(['crit']);
  expect(res.suppressed).toEqual([]);
});

test('carve-out: NEVER suppresses a secrets finding', async () => {
  const res = await applyInlineIgnores([finding({ line: 2, category: 'secrets', title: 'leak' })], '/');
  expect(res.kept.map(f => f.title)).toEqual(['leak']);
  expect(res.suppressed).toEqual([]);
});
