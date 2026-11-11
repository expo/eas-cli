import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readPreparedExpoGoAsync } from '../utils/preparedExpoGo';

let root: string;
let file: string;
let environment: NodeJS.ProcessEnv;
beforeEach(async () => {
  environment = { ...process.env };
  delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
  delete process.env.EXPO_GO_SDK_VERSION;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepared-expo-go-'));
  jest.spyOn(os, 'homedir').mockReturnValue(root);
  file = path.join(root, 'Library/Caches/expo-simulator-startup/prepared.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
});
afterEach(async () => {
  jest.restoreAllMocks();
  process.env = environment;
  await fs.rm(root, { recursive: true, force: true });
});

it('keeps standalone startup when no manifest exists', async () => {
  expect(await readPreparedExpoGoAsync()).toBeUndefined();
});
it('uses Expo Go metadata while ignoring legacy CLI pins and unrelated Appium data', async () => {
  const expoGo = { sdk: '58.0.0', url: 'https://example.test/expo-go.tar.gz' };
  await fs.writeFile(
    file,
    JSON.stringify({
      tools: {
        'serve-sim': { version: 'obsolete' },
        'agent-device': null,
        argent: { malformed: true },
        'expo-go': expoGo,
        appium: { unknownFutureFormat: true },
      },
    })
  );
  process.env.SERVE_SIM_VERSION = '0.13.4';
  expect(await readPreparedExpoGoAsync()).toEqual(expoGo);
  expect(process.env.SERVE_SIM_VERSION).toBe('0.13.4');
});
it.each([
  'not json',
  '{}',
  '{"tools":null}',
  JSON.stringify({ tools: { 'serve-sim': { version: 'latest' } } }),
  JSON.stringify({ tools: { 'expo-go': { sdk: '58.0.0', url: 'http://example.test/go.tar.gz' } } }),
])('treats missing or invalid optional Expo Go metadata as a cache miss (%s)', async contents => {
  await fs.writeFile(file, contents);
  expect(await readPreparedExpoGoAsync()).toBeUndefined();
});
it('does not read metadata when Expo Go preinstallation is disabled', async () => {
  process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO = '0';
  const read = jest.spyOn(fs, 'readFile');
  expect(await readPreparedExpoGoAsync()).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it.each(['58.0.0', '59.0.0'])(
  'uses prepared archive metadata only when it matches supplied SDK %s',
  async sdk => {
    const prepared = { sdk: '58.0.0', url: 'https://example.test/expo-go.tar.gz' };
    await fs.writeFile(file, JSON.stringify({ tools: { 'expo-go': prepared } }));
    process.env.EXPO_GO_SDK_VERSION = sdk;
    expect(await readPreparedExpoGoAsync()).toEqual(sdk === prepared.sdk ? prepared : undefined);
  }
);
