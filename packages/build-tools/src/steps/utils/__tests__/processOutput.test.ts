import { type bunyan } from '@expo/logger';

import { createProcessOutput } from '../processOutput';

const logger = { info: jest.fn() } as unknown as bunyan;

beforeEach(() => jest.clearAllMocks());

it('redacts split credentials before publishing complete lines', () => {
  const output = createProcessOutput(logger, ['turn secret']);
  output.stdout.append('https://preview.test/?tok');
  output.stdout.append('en=preview-secret&ok=true\n');
  output.stderr.append('Authorization: Bea');
  output.stderr.append('rer tool-secret\n{"credential":"turn secret"}\n');
  expect(logger.info).toHaveBeenNthCalledWith(
    1,
    { source: 'stdout' },
    'https://preview.test/?token=[REDACTED]&ok=true'
  );
  expect(logger.info).toHaveBeenNthCalledWith(
    2,
    { source: 'stderr' },
    'Authorization: Bearer [REDACTED]'
  );
  expect(output.getOutput()).not.toMatch(/preview-secret|tool-secret|turn secret/);
});

it.each([
  [
    'argent link argent://startup-secret@127.0.0.1:5678',
    'argent link argent://[REDACTED]@127.0.0.1:5678',
  ],
  [
    'argent link argent://encoded%2Fsecret@127.0.0.1:5678',
    'argent link argent://[REDACTED]@127.0.0.1:5678',
  ],
  [
    'argent link --host 127.0.0.1 --port 5678 --token startup-secret',
    'argent link --host 127.0.0.1 --port 5678 --token [REDACTED]',
  ],
  ['(or: argent link --token startup-secret)', '(or: argent link --token [REDACTED])'],
  [
    'argent link --token "quoted \\"secret\\"" --port 5678',
    'argent link --token [REDACTED] --port 5678',
  ],
  ["argent link --token='quoted secret' --port 5678", 'argent link --token=[REDACTED] --port 5678'],
])('redacts startup credentials at every chunk boundary: %s', (line, expected) => {
  for (let split = 0; split <= line.length; split++) {
    jest.mocked(logger.info).mockClear();
    const output = createProcessOutput(logger);
    output.stdout.append(line.slice(0, split));
    expect(logger.info).not.toHaveBeenCalled();
    output.stdout.append(line.slice(split) + '\n');
    expect(logger.info).toHaveBeenCalledWith({ source: 'stdout' }, expected);
    expect(output.getOutput()).toBe(expected + '\n');
  }
});

it('keeps stdout and stderr fragments separate and decodes split UTF-8', () => {
  const output = createProcessOutput(logger);
  const bytes = Buffer.from('hello 🌍\n');
  output.stdout.append(bytes.subarray(0, 8));
  output.stderr.append('error\n');
  output.stdout.append(bytes.subarray(8));
  expect(logger.info).toHaveBeenNthCalledWith(1, { source: 'stderr' }, 'error');
  expect(logger.info).toHaveBeenNthCalledWith(2, { source: 'stdout' }, 'hello 🌍');
});

it('omits overlong lines completely and keeps logging the following diagnostics', () => {
  const output = createProcessOutput(logger);
  output.stdout.append('https://preview.test/?token=');
  output.stdout.append('secret'.repeat(20_000));
  expect(logger.info).not.toHaveBeenCalled();
  output.stdout.append('\nfatal diagnostic\n');
  expect(logger.info).toHaveBeenNthCalledWith(
    1,
    { source: 'stdout' },
    '[Overlong output line omitted.]'
  );
  expect(logger.info).toHaveBeenNthCalledWith(2, { source: 'stdout' }, 'fatal diagnostic');
  expect(output.getOutput()).not.toContain('secret');
});

it('redacts final partial lines and bounds diagnostics without capping live output', () => {
  const output = createProcessOutput(logger);
  for (let index = 0; index < 100; index++) {
    output.stdout.append('x'.repeat(1023) + '\n');
  }
  output.stderr.append('token=final-secret');
  output.finish();
  expect(logger.info).toHaveBeenCalledTimes(101);
  expect(logger.info).toHaveBeenLastCalledWith({ source: 'stderr' }, 'token=[REDACTED]');
  expect(output.getOutput()).toHaveLength(64 * 1024);
  expect(output.getOutput()).toContain('token=[REDACTED]');
});

it('applies newly learned secrets to pending output and retained diagnostics', () => {
  const secrets: string[] = [];
  const output = createProcessOutput(undefined, secrets);
  output.stdout.append('opaque-secret\n');
  output.stderr.append('opaque-secret');
  secrets.push('opaque-secret');
  expect(output.getOutput()).not.toContain('opaque-secret');
});

it('redacts JSON token fields with escaped quotes before the token is known', () => {
  const output = createProcessOutput(logger);
  output.stdout.append(JSON.stringify({ authToken: 'a"b', controlToken: 'android-secret' }) + '\n');
  expect(logger.info).toHaveBeenCalledWith(
    { source: 'stdout' },
    '{"authToken":"[REDACTED]","controlToken":"[REDACTED]"}'
  );
});
