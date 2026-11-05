import { Parser } from '@oclif/core';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import Simulator from '../../commands/simulator';
import { prepareControlConfigAsync } from '../controlConfig';
import { resolveStartConfigAsync } from '../startConfig';

describe('simulator start configuration', () => {
  let folder: string;
  let file: string;
  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'simulator-start-config-'));
    file = path.join(folder, 'simulator.json');
  });
  afterEach(async () => fs.remove(folder));

  async function resolve(
    start: object,
    argv: string[] = [],
    actions?: object[]
  ): Promise<
    Awaited<ReturnType<typeof resolveStartConfigAsync>> & {
      parsed: Awaited<ReturnType<typeof Parser.parse>>;
    }
  > {
    await fs.writeJson(file, { version: 1, start, ...(actions ? { actions } : {}) });
    const resolved = await resolveStartConfigAsync(['--import', file, ...argv], Simulator.flags);
    return { ...resolved, parsed: await Parser.parse(resolved.argv, { flags: Simulator.flags }) };
  }

  it('uses saved values rather than command defaults and preserves explicit CLI overrides', async () => {
    const { parsed } = await resolve(
      {
        platform: 'ios',
        type: 'web-preview-only',
        force: false,
        device: 'Saved phone',
        tag: ['saved'],
        'public-link': true,
      },
      ['--device', 'CLI phone', '--tag', 'one', '--tag', 'two', '--json']
    );
    expect(parsed.flags).toMatchObject({
      platform: 'ios',
      type: 'web-preview-only',
      force: false,
      device: 'CLI phone',
      tag: ['one', 'two'],
      'public-link': true,
      json: true,
    });
  });

  it('lets explicit CLI defaults override different saved values', async () => {
    const { parsed } = await resolve({ type: 'web-preview-only', force: false }, [
      '--type',
      'agent-device',
      '--force',
    ]);
    expect(parsed.flags.type).toBe('agent-device');
    expect(parsed.flags.force).toBe(true);
  });

  it('lets the CLI disable saved public links and network capture with its saved fields', async () => {
    const { parsed } = await resolve(
      { 'public-link': true, 'network-capture': true, 'network-capture-field': ['header'] },
      ['--no-public-link', '--no-network-capture']
    );
    expect(parsed.flags['public-link']).toBe(false);
    expect(parsed.flags['network-capture']).toBe(false);
    expect(parsed.flags['network-capture-field']).toBeUndefined();
  });

  it('validates dependencies after merging and replaces array flags instead of appending', async () => {
    const { parsed } = await resolve(
      { 'network-capture': true, 'network-capture-field': ['header'] },
      ['--network-capture-field', 'request-body']
    );
    expect(parsed.flags['network-capture-field']).toEqual(['request-body']);
  });

  it('lets an explicit app source replace a saved exclusive source and its Expo Go SDK', async () => {
    const expoGo = await resolve({ 'build-id': 'saved-build' }, ['--expo-go']);
    expect(expoGo.parsed.flags['expo-go']).toBe(true);
    expect(expoGo.parsed.flags['build-id']).toBeUndefined();
    const build = await resolve({ 'expo-go': true, 'sdk-version': '55.0.0' }, [
      '--build-id',
      'cli-build',
    ]);
    expect(build.parsed.flags['build-id']).toBe('cli-build');
    expect(build.parsed.flags['expo-go']).toBeUndefined();
    expect(build.parsed.flags['sdk-version']).toBeUndefined();
    await expect(resolve({}, ['--build-id', 'cli-build', '--expo-go'])).rejects.toThrow(
      'cannot also be provided'
    );
  });

  it('rejects an empty import path instead of silently creating a default session', async () => {
    await expect(resolveStartConfigAsync(['--import='], Simulator.flags)).rejects.toThrow(
      'non-empty configuration file path'
    );
  });

  it('honors short flags and negated CLI booleans', async () => {
    const { parsed } = await resolve({ platform: 'android', force: true }, [
      '-p',
      'ios',
      '--no-force',
    ]);
    expect(parsed.flags.platform).toBe('ios');
    expect(parsed.flags.force).toBe(false);
  });

  it.each([
    { start: { unknown: 'x' }, message: 'Unknown or invocation-only' },
    { start: { json: true }, message: 'invocation-only' },
    { start: { 'non-interactive': true }, message: 'invocation-only' },
    { start: { import: 'nested.json' }, message: 'invocation-only' },
    { start: { 'expo-go': 'yes' }, message: 'must be a boolean' },
    { start: { device: ['one', 'two'] }, message: 'multiple values' },
    { start: { device: { name: 'phone' } }, message: 'string or number' },
    { start: { platform: 'windows' }, message: 'ios' },
    { start: { 'max-duration-minutes': -1 }, message: 'greater than or equal to 0' },
    { start: { 'build-id': 'abc', 'expo-go': true }, message: 'cannot also be provided' },
  ])('rejects invalid start values: $start', async ({ start, message }) => {
    await expect(resolve(start)).rejects.toThrow(message);
  });

  it('rejects a missing local input before creating a session', async () => {
    await expect(
      resolve({ platform: 'ios' }, [], [{ action: 'app.install', file: './missing.ipa' }])
    ).rejects.toThrow('does not exist on this computer');
  });

  it('rejects invalid output parents and device overrides during local preflight', async () => {
    await expect(
      resolve({}, [], [{ action: 'screenshot.capture', output: './missing/shot.png' }])
    ).rejects.toThrow('Config step 1');
    await expect(
      resolve({}, [], [{ action: 'appearance.get', params: { udid: 'other-device' } }])
    ).rejects.toThrow('remove params.udid');
  });

  it.each(['./missing/', './file.txt/'])(
    'rejects an output directory that does not exist: %s',
    async output => {
      await fs.writeFile(path.join(folder, 'file.txt'), 'existing file');
      await expect(resolve({}, [], [{ action: 'screenshot.capture', output }])).rejects.toThrow(
        'must be an existing directory'
      );
    }
  );

  it.each(['./screenshots/', './screen.png'])(
    'accepts an existing output directory or a new file: %s',
    async output => {
      await fs.mkdir(path.join(folder, 'screenshots'));
      await expect(
        resolve({}, [], [{ action: 'screenshot.capture', output }])
      ).resolves.toBeDefined();
    }
  );

  it('allows the same file in control import and resolves files relative to it', async () => {
    await fs.writeFile(path.join(folder, 'input.txt'), 'contents');
    const { config } = await resolve(
      { platform: 'ios' },
      [],
      [{ action: 'upload', file: './input.txt' }]
    );
    const prepared = await prepareControlConfigAsync(
      {
        upload: {
          type: 'object',
          properties: { udid: { type: 'string' }, path: { type: 'string' } },
          required: ['udid', 'path'],
          upload: 'path',
        },
      },
      file,
      'device'
    );
    expect(prepared.actions[0].plan.localFile?.path).toBe(path.join(folder, 'input.txt'));
    expect(config?.actions?.[0].params).toEqual({});
  });

  it('reports an unreadable file before trying to create a session', async () => {
    await expect(resolveStartConfigAsync(['--import', file], Simulator.flags)).rejects.toThrow(
      `Could not read simulator configuration ${file}`
    );
  });

  it('preserves no-import argv and reports malformed or unknown config fields', async () => {
    expect(await resolveStartConfigAsync(['--platform', 'ios'], Simulator.flags)).toEqual({
      argv: ['--platform', 'ios'],
    });
    await fs.writeJson(file, { version: 2, start: {} });
    await expect(resolveStartConfigAsync(['--import', file], Simulator.flags)).rejects.toThrow(
      'Invalid simulator configuration'
    );
    await fs.writeJson(file, { version: 1, typo: {} });
    await expect(resolveStartConfigAsync(['--import', file], Simulator.flags)).rejects.toThrow(
      'Invalid simulator configuration'
    );
  });
});
