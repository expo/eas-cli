import { test, expect } from 'bun:test';

import { sanitizeUntrusted } from '../core/prompts.js';

test('strips triple backticks and role/prompt tags', () => {
  const out = sanitizeUntrusted('```\nx\n``` <system>hi</system>');
  expect(out).not.toContain('```');
  expect(out.toLowerCase()).not.toContain('<system>');
});

test('neutralizes the coordinator PR_TITLE/PR_BODY boundary tokens', () => {
  const out = sanitizeUntrusted('line1\nPR_TITLE\n<<<PR_BODY\nline2');
  expect(out).not.toMatch(/^PR_TITLE$/m);
  expect(out).not.toContain('<<<PR_BODY');
  expect(out).toContain('line1');
  expect(out).toContain('line2');
});

test('truncates very long input', () => {
  const out = sanitizeUntrusted('a'.repeat(5000), 100);
  expect(out.length).toBeLessThan(200);
  expect(out).toContain('truncated');
});

test('empty input → empty string', () => {
  expect(sanitizeUntrusted('')).toBe('');
});
