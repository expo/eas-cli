import { ChildProcess, execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { runStartupScriptOncePerBootAsync } from '../commands/daemon';
import { installStartupDaemonAsync } from '../commands/install';

jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  const { promisify } = jest.requireActual('node:util');
  return {
    ...actual,
    spawn: jest.fn(),
    execFile: Object.assign(jest.fn(), {
      [promisify.custom]: jest.fn(),
    }),
  };
});

let root: string;
let home: string;
let directory: string;
let child: ChildProcess;

beforeEach(async () => {
  jest.resetAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vm-tools-test-'));
  home = path.join(root, 'guest & home');
  directory = path.join(root, 'read only startup');
  await fs.mkdir(home);
  await fs.mkdir(directory);
  jest.spyOn(os, 'homedir').mockReturnValue(home);
  jest.mocked(promisify(execFile)).mockResolvedValue({ stdout: 'boot-one\n', stderr: '' });
  child = Object.assign(new EventEmitter(), { kill: jest.fn() }) as unknown as ChildProcess;
  jest.mocked(spawn).mockImplementation(() => {
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

test('install writes an offline runner and Aqua agent without running a payload', async () => {
  const runnerPath = path.join(__dirname, '../main.ts');
  await installStartupDaemonAsync(
    runnerPath,
    path.join(__dirname, '../../resources/com.expo.vm-tools.plist')
  );
  const plist = await fs.readFile(
    path.join(home, 'Library/LaunchAgents/com.expo.vm-tools.plist'),
    'utf8'
  );
  expect(plist).toContain('guest &amp; home');
  expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<false\/>/);
  expect(plist).toMatch(/<key>LimitLoadToSessionType<\/key>\s*<string>Aqua<\/string>/);
  expect(plist).toContain(process.execPath);
  expect(plist).not.toContain('<key>Umask</key>');
  expect(plist).toContain('<string>daemon</string>');
  expect(plist).not.toContain('__NODE__');
  expect(await fs.readFile(path.join(home, '.expo/vm-tools/run'))).toEqual(
    await fs.readFile(runnerPath)
  );
  expect(spawn).not.toHaveBeenCalled();
  expect(promisify(execFile)).not.toHaveBeenCalled();
});

test('waits for a nonexecutable script and executes it once with bash', async () => {
  const pending = runStartupScriptOncePerBootAsync(directory);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(spawn).not.toHaveBeenCalled();
  const script = path.join(directory, 'startup.sh');
  await fs.writeFile(script, 'exit 0\n');
  await expect(pending).resolves.toBe(0);
  expect(spawn).toHaveBeenCalledWith('/bin/bash', [script], { stdio: 'inherit' });
  await expect(runStartupScriptOncePerBootAsync(directory)).resolves.toBe(0);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('waits for child exit, returns its error code, and does not retry', async () => {
  await fs.writeFile(path.join(directory, 'startup.sh'), 'exit 7\n');
  let launched!: () => void;
  const started = new Promise<void>(resolve => {
    launched = resolve;
  });
  jest.mocked(spawn).mockImplementation(() => {
    launched();
    return child;
  });
  let settled = false;
  const pending = runStartupScriptOncePerBootAsync(directory).then(code => {
    settled = true;
    return code;
  });
  await started;
  expect(settled).toBe(false);
  child.emit('exit', 7, null);
  await expect(pending).resolves.toBe(7);
  await expect(runStartupScriptOncePerBootAsync(directory)).resolves.toBe(0);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('a launch error consumes this boot instead of restarting the script', async () => {
  await fs.writeFile(path.join(directory, 'startup.sh'), 'exit 0\n');
  jest.mocked(spawn).mockImplementation(() => {
    setImmediate(() => child.emit('error', new Error('spawn failed')));
    return child;
  });
  await expect(runStartupScriptOncePerBootAsync(directory)).rejects.toThrow('spawn failed');
  await expect(runStartupScriptOncePerBootAsync(directory)).resolves.toBe(0);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('concurrent dispatchers execute only one payload', async () => {
  await fs.writeFile(path.join(directory, 'startup.sh'), 'exit 0\n');
  await expect(
    Promise.all([
      runStartupScriptOncePerBootAsync(directory),
      runStartupScriptOncePerBootAsync(directory),
    ])
  ).resolves.toEqual([0, 0]);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('forwards teardown signals to the foreground script and waits for its exit', async () => {
  await fs.writeFile(path.join(directory, 'startup.sh'), 'exit 0\n');
  let launched!: () => void;
  const started = new Promise<void>(resolve => {
    launched = resolve;
  });
  jest.mocked(spawn).mockImplementation(() => {
    launched();
    return child;
  });
  const pending = runStartupScriptOncePerBootAsync(directory);
  await started;
  process.emit('SIGTERM', 'SIGTERM');
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  child.emit('exit', null, 'SIGTERM');
  await expect(pending).resolves.toBe(1);
  await expect(runStartupScriptOncePerBootAsync(directory)).resolves.toBe(0);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('teardown before launch releases this boot for a later invocation', async () => {
  await fs.writeFile(path.join(directory, 'startup.sh'), 'exit 0\n');
  const mkdir = fs.mkdir;
  jest.spyOn(fs, 'mkdir').mockImplementation(async (target, options) => {
    const result = await mkdir(target, options);
    if (path.basename(String(target)) === 'started-boot-one') {
      process.emit('SIGTERM', 'SIGTERM');
    }
    return result;
  });
  await expect(runStartupScriptOncePerBootAsync(directory)).rejects.toThrow(
    'VM startup was interrupted.'
  );
  expect(spawn).not.toHaveBeenCalled();
  await expect(fs.stat(path.join(home, '.expo/vm-tools/started-boot-one'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  jest.mocked(fs.mkdir).mockRestore();
  await expect(runStartupScriptOncePerBootAsync(directory)).resolves.toBe(0);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('teardown cancels waiting for a missing mount without executing anything', async () => {
  const pending = runStartupScriptOncePerBootAsync(directory);
  const rejected = expect(pending).rejects.toThrow();
  process.emit('SIGTERM', 'SIGTERM');
  await rejected;
  expect(spawn).not.toHaveBeenCalled();
});
