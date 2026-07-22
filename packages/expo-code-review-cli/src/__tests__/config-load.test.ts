import { test, expect } from 'bun:test';

import { parseFrontmatter, stripJsonComments, stripTrailingCommas } from '../config/load.js';

test('parseFrontmatter: parses scalar keys + returns body without frontmatter', () => {
  const { data, body } = parseFrontmatter('---\nmodel: x\nalwaysRun: true\n---\n# Body\ntext');
  expect(data.model).toBe('x');
  expect(data.alwaysRun).toBe('true');
  expect(body).toBe('# Body\ntext');
});

test('parseFrontmatter: no frontmatter → empty data, full body', () => {
  const { data, body } = parseFrontmatter('# Just body');
  expect(data).toEqual({});
  expect(body).toBe('# Just body');
});

test('stripJsonComments: removes // and /* */ but not inside strings', () => {
  expect(stripJsonComments('{"a":1 // comment\n}')).not.toContain('comment');
  expect(stripJsonComments('{"a":1 /* c */}')).not.toContain('/*');
  expect(stripJsonComments('{"url":"http://x"}')).toContain('http://x');
});

test('stripTrailingCommas: removes trailing commas (JSONC parse regression)', () => {
  expect(JSON.parse(stripTrailingCommas('{"a":1,}'))).toEqual({ a: 1 });
  expect(JSON.parse(stripTrailingCommas('[1,2,]'))).toEqual([1, 2]);
  // A comma inside a string must be preserved.
  expect(stripTrailingCommas('{"s":"a,"}')).toBe('{"s":"a,"}');
});
