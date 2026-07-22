import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { verifyFindings } from '../core/verify.js';
import type { Finding } from '../core/schema.js';
import type { OpencodeHandle } from '../core/opencode.js';

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ecr-verify-test-'));
  file = path.join(dir, 'sample.ts');
  writeFileSync(file, 'export const answer = 42;\nfunction realThing() { return items[next++]!; }\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const finding = (over: Partial<Finding>): Finding => ({
  severity: 'warning',
  category: 'correctness',
  file,
  line: 1,
  title: 'T',
  rationale: 'r',
  ...over,
});

// A dummy handle is safe here: only NON-critical findings are used, so the LLM
// verify path (which would need a real server) is never reached.
const handle = {} as OpencodeHandle;

test('quote-grounding keeps findings whose evidence is present, drops absent ones', async () => {
  const findings = [
    finding({ title: 'present', evidence: 'return items[next++]!;' }),
    finding({ title: 'hallucinated', evidence: 'const item = next++; // not in the file' }),
  ];
  const res = await verifyFindings(handle, findings, '/', undefined);
  expect(res.kept.map(f => f.title)).toEqual(['present']);
  expect(res.dropped.map(d => d.finding.title)).toEqual(['hallucinated']);
});

test('too-short evidence is unknown, never dropped', async () => {
  const res = await verifyFindings(handle, [finding({ title: 'short', evidence: 'x}' })], '/', undefined);
  expect(res.kept.map(f => f.title)).toEqual(['short']);
});

test('unreadable file is unknown, never dropped', async () => {
  const f = finding({ title: 'missing-file', file: '/no/such/file.ts', evidence: 'const somethingLongEnough = 1;' });
  const res = await verifyFindings(handle, [f], '/', undefined);
  expect(res.kept.map(x => x.title)).toEqual(['missing-file']);
});
