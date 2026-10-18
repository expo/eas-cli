import * as fs from 'fs-extra';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { executeControlActionAsync, prepareControlActionAsync } from '../controlActions';
import { HostActionCatalog, HostActionConnection, HostActionResult } from '../hostActions';

const catalog: HostActionCatalog = {
  settings: { type: 'object' },
  install: { upload: 'uploadId', uploadAs: 'id' },
  media: { upload: 'path' },
  camera: { upload: 'target', uploadWhen: { source: 'file' }, keepUpload: true },
  screenshot: { output: 'path' },
  download: { output: 'base64' },
};
const ok = (stdout = ''): HostActionResult => ({ stdout, stderr: '', exitCode: 0 });

describe('control action preparation and execution', () => {
  let tmpDir: string;
  let controller: AbortController;
  let result: HostActionResult;
  let connection: HostActionConnection;
  let requestAsync: jest.Mock<Promise<HostActionResult>, [string, Record<string, unknown>?]>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'control-actions-'));
    controller = new AbortController();
    result = ok(' on\n');
    requestAsync = jest.fn(async (action: string, params: Record<string, unknown> = {}) => {
      if (action === 'upload.append') {
        return ok(`/remote/staging/${params.uploadId}\n`);
      }
      if (action === 'upload.remove') {
        return ok();
      }
      if (action === 'file.readBase64') {
        return ok(Buffer.from('download bytes').toString('base64'));
      }
      return result;
    });
    connection = {
      udid: '90858C9D-BC34-4A0A-93D4-E4939A681A72',
      signal: controller.signal,
      requestAsync,
      close: () => {
        controller.abort(new Error('closed'));
      },
    };
    await fs.writeFile(path.join(tmpDir, 'fixture.json'), 'file bytes');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('copies typed and empty values into an immutable plan without parsing stdout', async () => {
    const params = { enabled: false, count: 0, text: '', nested: { values: ['original'] } };
    const plan = await prepareControlActionAsync(catalog, { action: 'settings', params });
    params.nested.values.push('changed');
    expect(plan.params).toEqual({
      enabled: false,
      count: 0,
      text: '',
      nested: { values: ['original'] },
    });
    expect(Object.isFrozen(plan.params.nested)).toBe(true);
    result = ok(' {"value":0}\n');

    await expect(executeControlActionAsync(connection, plan)).resolves.toEqual({
      output: '{"value":0}',
      file: null,
    });
    expect(requestAsync).toHaveBeenCalledWith('settings', plan.params);
    result = ok('');
    await expect(executeControlActionAsync(connection, plan)).resolves.toEqual({
      output: '',
      file: null,
    });
  });

  it('rejects unknown actions and inapplicable output before execution', async () => {
    await expect(
      prepareControlActionAsync(catalog, { action: 'toString', params: {} })
    ).rejects.toThrow('Unknown simulator action');
    await expect(
      prepareControlActionAsync(catalog, { action: 'settings', params: {}, outputPath: './out' })
    ).rejects.toThrow('does not return a file');
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('resolves explicit local files and outputs against the supplied directory', async () => {
    const plan = await prepareControlActionAsync(
      catalog,
      {
        action: 'install',
        params: {},
        file: 'fixture.json',
      },
      { localFileMode: 'explicit', baseDir: tmpDir }
    );
    expect(plan.localFile).toEqual({ param: 'uploadId', path: path.join(tmpDir, 'fixture.json') });
    const output = await prepareControlActionAsync(
      catalog,
      {
        action: 'download',
        params: {},
        outputPath: 'result.json',
      },
      { baseDir: tmpDir }
    );
    expect(output.outputPath).toBe(path.join(tmpDir, 'result.json'));
  });

  it('preserves an explicitly requested output directory when resolving relative paths', async () => {
    await expect(
      prepareControlActionAsync(
        catalog,
        {
          action: 'download',
          params: {},
          outputPath: 'missing/',
        },
        { baseDir: tmpDir }
      )
    ).rejects.toThrow('does not exist');
  });

  it('rejects ambiguous or inapplicable explicit uploads', async () => {
    for (const action of [
      { action: 'settings', params: {} },
      { action: 'camera', params: { source: 'webcam' } },
      { action: 'install', params: { uploadId: 'already-supplied' } },
    ]) {
      await expect(
        prepareControlActionAsync(catalog, {
          ...action,
          file: path.join(tmpDir, 'fixture.json'),
        })
      ).rejects.toThrow();
    }
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('rejects missing, empty and directory inputs before execution', async () => {
    await fs.writeFile(path.join(tmpDir, 'empty'), '');
    for (const file of ['missing', 'empty', '.']) {
      await expect(
        prepareControlActionAsync(
          catalog,
          {
            action: 'install',
            params: {},
            file,
          },
          { baseDir: tmpDir }
        )
      ).rejects.toThrow();
    }
    expect(requestAsync).not.toHaveBeenCalled();
  });

  it('preserves direct local-path heuristics and does not infer uploads in explicit mode', async () => {
    const localFile = path.join(tmpDir, 'fixture.json');
    expect(
      (
        await prepareControlActionAsync(catalog, {
          action: 'media',
          params: { path: localFile },
        })
      ).localFile?.path
    ).toBe(localFile);
    const remotePath = path.join(tmpDir, 'remote-only');
    expect(
      (
        await prepareControlActionAsync(catalog, {
          action: 'media',
          params: { path: remotePath },
        })
      ).localFile
    ).toBeUndefined();
    await expect(
      prepareControlActionAsync(
        catalog,
        {
          action: 'media',
          params: { path: 'missing-relative' },
        },
        { baseDir: tmpDir }
      )
    ).rejects.toThrow('does not exist on this computer');
    expect(
      (
        await prepareControlActionAsync(
          catalog,
          {
            action: 'media',
            params: { path: localFile },
          },
          { localFileMode: 'explicit' }
        )
      ).localFile
    ).toBeUndefined();
    expect(
      (
        await prepareControlActionAsync(catalog, {
          action: 'camera',
          params: { source: 'webcam', target: 'Built-in Camera' },
        })
      ).localFile
    ).toBeUndefined();
  });

  it('resolves a direct relative upload against baseDir without rewriting caller parameters', async () => {
    const params = { path: './fixture.json' };
    const plan = await prepareControlActionAsync(
      catalog,
      { action: 'media', params },
      { baseDir: tmpDir }
    );
    expect(plan.localFile?.path).toBe(path.join(tmpDir, 'fixture.json'));
    await executeControlActionAsync(connection, plan);
    expect(requestAsync.mock.calls[1]).toEqual([
      'media',
      { path: `/remote/staging/${requestAsync.mock.calls[0][1]?.uploadId}` },
    ]);
    expect(params).toEqual({ path: './fixture.json' });
  });

  (process.platform === 'win32' ? it.skip : it)(
    'rejects a named pipe before opening it for upload',
    async () => {
      const file = path.join(tmpDir, 'input.pipe');
      execFileSync('mkfifo', [file]);
      await expect(
        prepareControlActionAsync(catalog, {
          action: 'install',
          params: {},
          file,
        })
      ).rejects.toThrow('not a regular file');
      expect(requestAsync).not.toHaveBeenCalled();
    }
  );

  (process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it)(
    'rejects a local file that cannot be read before upload',
    async () => {
      const file = path.join(tmpDir, 'fixture.json');
      await fs.chmod(file, 0);
      try {
        await expect(
          prepareControlActionAsync(catalog, {
            action: 'install',
            params: {},
            file,
          })
        ).rejects.toMatchObject({ code: 'EACCES' });
        expect(requestAsync).not.toHaveBeenCalled();
      } finally {
        await fs.chmod(file, 0o600);
      }
    }
  );

  it('substitutes an upload ID without changing the plan and removes staging after success', async () => {
    const plan = await prepareControlActionAsync(catalog, {
      action: 'install',
      params: {},
      file: path.join(tmpDir, 'fixture.json'),
    });
    await executeControlActionAsync(connection, plan);
    const uploadId = requestAsync.mock.calls[0][1]?.uploadId;
    expect(uploadId).toMatch(/^eas-cli-[0-9a-f-]{36}\.json$/);
    expect(requestAsync.mock.calls).toEqual([
      [
        'upload.append',
        { uploadId, data: Buffer.from('file bytes').toString('base64'), first: true },
      ],
      ['install', { uploadId }],
      ['upload.remove', { uploadId }],
    ]);
    expect(plan.params).toEqual({});
  });

  it('keeps a successful camera upload but cleans it after a failed action', async () => {
    const plan = await prepareControlActionAsync(catalog, {
      action: 'camera',
      params: { source: 'file' },
      file: path.join(tmpDir, 'fixture.json'),
    });
    await executeControlActionAsync(connection, plan);
    expect(requestAsync.mock.calls.map(([name]) => name)).toEqual(['upload.append', 'camera']);
    expect(requestAsync.mock.calls[1][1]).toEqual({
      source: 'file',
      target: `/remote/staging/${requestAsync.mock.calls[0][1]?.uploadId}`,
    });
    requestAsync.mockClear();
    result = { stdout: '', stderr: 'camera unavailable', exitCode: 1 };
    await expect(executeControlActionAsync(connection, plan)).rejects.toThrow('camera unavailable');
    expect(requestAsync.mock.calls.map(([name]) => name)).toEqual([
      'upload.append',
      'camera',
      'upload.remove',
    ]);
    expect(controller.signal.aborted).toBe(false);
  });

  it('cleans staging if validation rejects real uploaded parameters', async () => {
    const plan = await prepareControlActionAsync(catalog, {
      action: 'camera',
      params: { source: 'file' },
      file: path.join(tmpDir, 'fixture.json'),
    });
    const validateParams = jest.fn(() => {
      throw new Error('invalid uploaded path');
    });
    await expect(executeControlActionAsync(connection, plan, { validateParams })).rejects.toThrow(
      'invalid uploaded path'
    );
    expect(validateParams).toHaveBeenCalledWith({
      source: 'file',
      target: `/remote/staging/${requestAsync.mock.calls[0][1]?.uploadId}`,
    });
    expect(requestAsync.mock.calls.map(([name]) => name)).toEqual([
      'upload.append',
      'upload.remove',
    ]);
  });

  it('removes a failed upload without running the action', async () => {
    requestAsync.mockImplementation(async action =>
      action === 'upload.append' ? { stdout: '', stderr: 'staging full', exitCode: 1 } : ok()
    );
    const plan = await prepareControlActionAsync(catalog, {
      action: 'install',
      params: {},
      file: path.join(tmpDir, 'fixture.json'),
    });
    await expect(executeControlActionAsync(connection, plan)).rejects.toThrow('staging full');
    expect(requestAsync.mock.calls.map(([name]) => name)).toEqual([
      'upload.append',
      'upload.remove',
    ]);
  });

  it('saves an action output and returns the path instead of raw bytes', async () => {
    result = ok(Buffer.from('file content').toString('base64'));
    const outputPath = path.join(tmpDir, 'output');
    const plan = await prepareControlActionAsync(catalog, {
      action: 'download',
      params: {},
      outputPath,
    });
    await expect(executeControlActionAsync(connection, plan)).resolves.toEqual({
      output: '',
      file: outputPath,
    });
    expect(await fs.readFile(outputPath, 'utf8')).toBe('file content');
  });

  it('removes staging if the output directory disappears after preparation', async () => {
    const outputDir = path.join(tmpDir, 'output');
    await fs.mkdir(outputDir);
    const plan = await prepareControlActionAsync(
      {
        snapshot: { upload: 'path', output: 'base64' },
      },
      {
        action: 'snapshot',
        params: {},
        file: path.join(tmpDir, 'fixture.json'),
        outputPath: path.join(outputDir, 'snapshot.png'),
      }
    );
    await fs.remove(outputDir);
    result = ok(Buffer.from('png').toString('base64'));
    await expect(executeControlActionAsync(connection, plan)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(requestAsync.mock.calls.map(([name]) => name)).toEqual([
      'upload.append',
      'snapshot',
      'upload.remove',
    ]);
    expect(controller.signal.aborted).toBe(false);
  });

  it.each([
    [{ stdout: 'failure on stdout', stderr: '', exitCode: 1 }, 'failure on stdout'],
    [{ stdout: '', stderr: '', exitCode: 7 }, 'exit code 7'],
  ])(
    'reports server failure details without closing a usable connection',
    async (failure, message) => {
      result = failure as HostActionResult;
      const plan = await prepareControlActionAsync(catalog, { action: 'settings', params: {} });
      await expect(executeControlActionAsync(connection, plan)).rejects.toThrow(message);
      expect(controller.signal.aborted).toBe(false);
    }
  );

  it('does not send work after a terminal connection loss', async () => {
    const plan = await prepareControlActionAsync(catalog, { action: 'settings', params: {} });
    const error = new Error('connection lost');
    controller.abort(error);
    await expect(executeControlActionAsync(connection, plan)).rejects.toBe(error);
    expect(requestAsync).not.toHaveBeenCalled();
  });
});
