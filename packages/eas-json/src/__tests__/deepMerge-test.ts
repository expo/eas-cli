import { deepMerge } from '../EasJsonReader';

test('deepMerge: case 1', async () => {
  const result = deepMerge({ b: 'test', c: 'test2' }, { b: 'test1' });
  expect(result).toEqual({ b: 'test1', c: 'test2' });
});

test('deepMerge: case 2', async () => {
  const result = deepMerge({ a: { b: 'test', c: 'test2' } }, { a: { b: 'test1' } });
  expect(result).toEqual({ a: { b: 'test1', c: 'test2' } });
});

test('deepMerge: case 3', async () => {
  const result = deepMerge({ a: { b: 'test' } }, { a: { b: 'test1', d: 'test3' } });
  expect(result).toEqual({ a: { b: 'test1', d: 'test3' } });
});

test('deepMerge: case 4', async () => {
  const result = deepMerge({ a: 'test' }, { a: { b: 'test1', d: 'test3' } });
  expect(result).toEqual({ a: { b: 'test1', d: 'test3' } });
});

test('deepMerge: case 5', async () => {
  const result = deepMerge({ a: { b: 'test1', d: 'test3' } }, { a: 'test' });
  expect(result).toEqual({ a: 'test' });
});

test('deepMerge: case 5', async () => {
  const result = deepMerge({ a: { b: 'test1', d: 'test3' } }, { a: 0 });
  expect(result).toEqual({ a: 0 });
});

test('deepMerge: case 6', async () => {
  const result = deepMerge({ a: { b: 'test1', d: 'test3' } }, { a: null });
  expect(result).toEqual({ a: null });
});

test('deepMerge: case 7', async () => {
  const result = deepMerge({ a: { b: 'test1', d: 'test3' } }, { a: undefined });
  expect(result).toEqual({ a: { b: 'test1', d: 'test3' } });
});

test('deepMerge: case 8', async () => {
  const result = deepMerge({ a: 'test' }, { a: 0 });
  expect(result).toEqual({ a: 0 });
});

test('deepMerge: case 9', async () => {
  const result = deepMerge({ a: 'test' }, { a: null });
  expect(result).toEqual({ a: null });
});

test('deepMerge: case 10', async () => {
  const result = deepMerge({ a: 'test' }, { a: undefined });
  expect(result).toEqual({ a: 'test' });
});
