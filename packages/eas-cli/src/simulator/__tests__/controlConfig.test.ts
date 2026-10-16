import * as fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { executeControlConfigAsync, prepareControlConfigAsync } from '../controlConfig';
import { HostActionCatalog, HostActionConnection, HostActionResult } from '../hostActions';

const catalog: HostActionCatalog = {
  'keyboard.set': {
    type: 'object',
    properties: { udid: { type: 'string' }, value: { enum: ['on', 'off'] } },
    required: ['udid', 'value'],
    additionalProperties: false,
  },
  'file.push': {
    type: 'object',
    properties: {
      udid: { type: 'string' },
      uploadId: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' },
      destination: { type: 'string' },
    },
    required: ['udid', 'uploadId', 'destination'],
    additionalProperties: false,
    upload: 'uploadId',
    uploadAs: 'id',
  },
  'camera.set': {
    type: 'object',
    properties: {
      udid: { type: 'string' },
      source: { enum: ['file', 'webcam'] },
      path: { type: 'string' },
    },
    required: ['udid', 'source', 'path'],
    upload: 'path',
    uploadWhen: { source: 'file' },
    keepUpload: true,
  },
  screenshot: {
    type: 'object',
    properties: { udid: { type: 'string' } },
    required: ['udid'],
    additionalProperties: false,
    output: 'base64',
  },
  echo: {
    type: 'object',
    properties: {
      udid: { type: 'string' },
      text: { type: 'string' },
      enabled: { type: 'boolean' },
      count: { type: 'number' },
      items: { type: 'array', items: { type: 'string' } },
    },
    required: ['udid'],
    additionalProperties: false,
  },
};

describe('simulator control configuration', () => {
  let folder: string;
  let filePath: string;
  const ok = (stdout = ''): HostActionResult => ({ stdout, stderr: '', exitCode: 0 });
  const requestAsync = jest.fn(async (action: string): Promise<HostActionResult> => {
    if (action === 'upload.append') {
      return ok('/remote/staged.txt\n');
    }
    if (action === 'screenshot') {
      return ok(Buffer.from('png').toString('base64'));
    }
    return ok('done\n');
  });
  const connection: HostActionConnection = {
    requestAsync,
    close: jest.fn(),
    signal: new AbortController().signal,
    udid: 'owned-udid',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'control-config-'));
    filePath = path.join(folder, 'simulator.json');
  });

  afterEach(async () => {
    await fs.remove(folder);
  });

  async function writeConfig(actions: unknown[], rest = {}): Promise<void> {
    await fs.writeJson(filePath, { version: 1, actions, ...rest });
  }

  it('preserves typed, omitted and empty values without changing the input', async () => {
    const params = { text: '', enabled: false, count: 0, items: ['first', 'second'] };
    await writeConfig([{ action: 'echo', params }, { action: 'echo' }]);
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    const results = await executeControlConfigAsync(connection, config);
    expect(requestAsync.mock.calls).toEqual([
      ['echo', params],
      ['echo', {}],
    ]);
    expect(results).toEqual([
      { action: 'echo', output: 'done', file: null },
      { action: 'echo', output: 'done', file: null },
    ]);
    expect((await fs.readJson(filePath)).actions[0].params).toEqual(params);
  });

  it.each([
    { version: 2, actions: [{ action: 'echo' }] },
    { version: 1, actions: [] },
    { version: 1, actions: [{ action: 'echo', extra: true }] },
    { version: 1, actions: [{ action: 'echo', params: [] }] },
    { version: 1, actions: [{ action: 'echo', params: { udid: 'other-device' } }] },
    { version: 1, actions: [{ action: 'echo' }], sessionId: 'other-session' },
  ])('rejects an invalid config envelope: %j', async input => {
    await fs.writeJson(filePath, input);
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow();
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('reports invalid JSON with its config path', async () => {
    await fs.writeFile(filePath, '{ invalid');
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow(
      'simulator.json'
    );
  });

  it('rejects a missing config file', async () => {
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow();
  });

  it('preflights later steps before running any action or upload', async () => {
    await fs.writeFile(path.join(folder, 'fixture.txt'), 'content');
    await writeConfig([
      { action: 'file.push', params: { destination: 'data.txt' }, file: './fixture.txt' },
      { action: 'keyboard.set', params: { value: 'invalid' } },
    ]);
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow(
      /step 2.*keyboard\.set/i
    );
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('rejects unknown actions before any execution', async () => {
    await writeConfig([{ action: 'echo' }, { action: 'missing' }]);
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow(
      /step 2.*missing/i
    );
  });

  it('requires an explicit output for path downloads before executing earlier steps', async () => {
    const withDownload: HostActionCatalog = {
      ...catalog,
      'screenshot.capture': { ...catalog.screenshot, output: 'path' },
    };
    await writeConfig([{ action: 'echo' }, { action: 'screenshot.capture' }]);
    await expect(
      prepareControlConfigAsync(withDownload, filePath, connection.udid)
    ).rejects.toThrow(/step 2.*screenshot\.capture.*output/i);
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('rejects mistyped parameters rather than coercing JSON', async () => {
    await writeConfig([{ action: 'echo', params: { count: '12' } }]);
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow(
      /count/i
    );
  });

  it('uses JSON Schema 2020-12 and leaves schema defaults omitted', async () => {
    const withTuple: HostActionCatalog = {
      tuple: {
        type: 'object',
        properties: {
          udid: { type: 'string' },
          value: {
            type: 'array',
            prefixItems: [{ type: 'number' }, { type: 'string' }],
            items: false,
          },
          enabled: { type: 'boolean', default: true },
        },
        required: ['udid', 'value'],
      },
    };
    await writeConfig([{ action: 'tuple', params: { value: [7, 'text'] } }]);
    const config = await prepareControlConfigAsync(withTuple, filePath, connection.udid);
    await executeControlConfigAsync(connection, config);
    expect(requestAsync).toHaveBeenCalledWith('tuple', { value: [7, 'text'] });
    await writeConfig([{ action: 'tuple', params: { value: ['wrong', 'text'] } }]);
    await expect(prepareControlConfigAsync(withTuple, filePath, connection.udid)).rejects.toThrow(
      /params\/value\/0/
    );
  });

  it('refuses to execute a plan checked for another simulator', async () => {
    await writeConfig([{ action: 'echo' }]);
    const config = await prepareControlConfigAsync(catalog, filePath, 'another-udid');
    await expect(executeControlConfigAsync(connection, config)).rejects.toThrow(
      'simulator changed'
    );
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('resolves explicit local files relative to the config and substitutes upload IDs', async () => {
    await fs.writeFile(path.join(folder, 'fixture.txt'), 'content');
    await writeConfig([
      { action: 'file.push', params: { destination: 'data.txt' }, file: './fixture.txt' },
    ]);
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    expect(requestAsync).not.toHaveBeenCalled();
    await executeControlConfigAsync(connection, config);
    expect(requestAsync).toHaveBeenCalledWith('upload.append', {
      uploadId: expect.stringMatching(/^eas-cli-.+\.txt$/),
      data: Buffer.from('content').toString('base64'),
      first: true,
    });
    const call = requestAsync.mock.calls.find(([action]) => action === 'file.push');
    expect(call).toEqual([
      'file.push',
      { destination: 'data.txt', uploadId: expect.stringMatching(/^eas-cli-.+\.txt$/) },
    ]);
    expect(requestAsync).toHaveBeenLastCalledWith('upload.remove', {
      uploadId: expect.stringMatching(/^eas-cli-.+\.txt$/),
    });
  });

  it('keeps remote paths unchanged even when a similarly named local file exists', async () => {
    const localPath = path.join(folder, 'fixture.txt');
    await fs.writeFile(localPath, 'local content');
    await writeConfig([{ action: 'camera.set', params: { source: 'file', path: localPath } }]);
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    await executeControlConfigAsync(connection, config);
    expect(requestAsync.mock.calls).toEqual([['camera.set', { source: 'file', path: localPath }]]);
  });

  it('resolves output paths relative to the config', async () => {
    await writeConfig([{ action: 'screenshot', output: './screen.png' }]);
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    const results = await executeControlConfigAsync(connection, config);
    expect(await fs.readFile(path.join(folder, 'screen.png'), 'utf8')).toBe('png');
    expect(results[0].file).toBe(path.join(folder, 'screen.png'));
  });

  it.each(['existing file', 'new file', 'download directory'])(
    'rejects an unwritable %s before running earlier actions',
    async kind => {
      const destination = path.join(folder, 'read-only');
      const output = kind === 'new file' ? path.join(destination, 'screen.png') : destination;
      if (kind === 'existing file') {
        await fs.writeFile(destination, 'existing image');
        await fs.chmod(destination, 0o444);
      } else {
        await fs.mkdir(destination);
        await fs.chmod(destination, 0o555);
      }
      const action = kind === 'download directory' ? 'download' : 'screenshot';
      const withDownload: HostActionCatalog = {
        ...catalog,
        download: { ...catalog.screenshot, output: 'path' },
      };
      try {
        await writeConfig([{ action: 'echo' }, { action, output }]);
        await expect(
          prepareControlConfigAsync(withDownload, filePath, connection.udid)
        ).rejects.toThrow(/step 2.*(EACCES|permission)/i);
        expect(requestAsync).not.toHaveBeenCalled();
      } finally {
        await fs.chmod(destination, 0o755);
      }
    }
  );

  it.each(['app.install', 'media.add'])(
    'rejects an explicit file combined with another source for %s',
    async action => {
      const realCatalog: HostActionCatalog = require('./fixtures/hostActionCatalog.json');
      await fs.writeFile(path.join(folder, 'new.ipa'), 'new bytes');
      await writeConfig([{ action, params: { uploadId: 'old.ipa' }, file: './new.ipa' }]);
      await expect(
        prepareControlConfigAsync(realCatalog, filePath, connection.udid)
      ).rejects.toThrow(/file.*source/i);
      expect(requestAsync).not.toHaveBeenCalled();
    }
  );

  it('accepts an explicit file as the only source of a union action', async () => {
    const realCatalog: HostActionCatalog = require('./fixtures/hostActionCatalog.json');
    await fs.writeFile(path.join(folder, 'new.ipa'), 'new bytes');
    await writeConfig([{ action: 'app.install', file: './new.ipa' }]);
    const config = await prepareControlConfigAsync(realCatalog, filePath, connection.udid);
    await executeControlConfigAsync(connection, config);
    expect(requestAsync).toHaveBeenCalledWith('app.install', { path: '/remote/staged.txt' });
  });

  it.each([
    { action: 'echo', file: './fixture.txt' },
    { action: 'file.push', params: { destination: 'data.txt' }, file: './missing.txt' },
    { action: 'file.push', params: { destination: 'data.txt' }, file: '.' },
    { action: 'camera.set', params: { source: 'webcam', path: 'camera' }, file: './fixture.txt' },
    {
      action: 'file.push',
      params: { destination: 'data.txt', uploadId: 'already-staged' },
      file: './fixture.txt',
    },
    { action: 'screenshot', output: './missing/screen.png' },
  ])('rejects invalid file/output plans before execution: %j', async action => {
    await fs.writeFile(path.join(folder, 'fixture.txt'), 'content');
    await writeConfig([action]);
    await expect(prepareControlConfigAsync(catalog, filePath, connection.udid)).rejects.toThrow();
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('stops on the first runtime error and reports completed steps', async () => {
    await writeConfig([
      { action: 'echo', params: { text: 'first' } },
      { action: 'keyboard.set', params: { value: 'off' } },
      { action: 'echo', params: { text: 'third' } },
    ]);
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    requestAsync.mockResolvedValueOnce(ok('first')).mockResolvedValueOnce({
      stdout: '',
      stderr: 'device stopped',
      exitCode: 1,
    });
    await expect(executeControlConfigAsync(connection, config)).rejects.toMatchObject({
      step: 2,
      action: 'keyboard.set',
      completed: [{ action: 'echo', output: 'first', file: null }],
    });
    expect(requestAsync.mock.calls).toEqual([
      ['echo', { text: 'first' }],
      ['keyboard.set', { value: 'off' }],
    ]);
  });

  it('preserves a non-Error failure without retrying the action', async () => {
    await writeConfig([{ action: 'echo' }]);
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    requestAsync.mockRejectedValueOnce('connection lost');
    await expect(executeControlConfigAsync(connection, config)).rejects.toMatchObject({
      step: 1,
      completed: [],
      message: expect.stringContaining('connection lost'),
    });
    expect(requestAsync).toHaveBeenCalledTimes(1);
  });

  it('validates the actual uploaded value before invoking an action', async () => {
    const strict: HostActionCatalog = {
      'file.push': {
        ...catalog['file.push'],
        uploadAs: 'path',
        properties: {
          ...catalog['file.push'].properties,
          uploadId: { type: 'string', pattern: '^/tmp/serve-sim-uploads/' },
        },
      },
    };
    await fs.writeFile(path.join(folder, 'fixture.txt'), 'content');
    await writeConfig([
      { action: 'file.push', params: { destination: 'data.txt' }, file: './fixture.txt' },
    ]);
    const config = await prepareControlConfigAsync(strict, filePath, connection.udid);
    await expect(executeControlConfigAsync(connection, config)).rejects.toThrow(/uploadId/);
    expect(requestAsync.mock.calls.map(([name]) => name)).toEqual([
      'upload.append',
      'upload.remove',
    ]);
  });
});
