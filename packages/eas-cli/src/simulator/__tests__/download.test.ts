import fs from 'fs-extra';
import * as nodeFs from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import fetch, { Response } from '../../fetch';
import { downloadSimulatorFileAsync } from '../download';

let directory: string;
let output: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sim-artifact-test-'));
  output = path.join(directory, 'capture.har');
});
afterEach(async () => {
  await fs.remove(directory);
});

it('writes private files and removes its interrupt listener after success', async () => {
  const listeners = process.listeners('SIGINT');
  await expect(
    downloadSimulatorFileAsync(output, async () => new Response(Readable.from(['private'])))
  ).resolves.toBe(output);
  expect(await fs.readFile(output, 'utf8')).toBe('private');
  expect((await fs.stat(output)).mode & 0o777).toBe(0o600);
  expect(process.listeners('SIGINT')).toEqual(listeners);
});

it('preserves an existing output file', async () => {
  await fs.writeFile(output, 'existing');
  await expect(
    downloadSimulatorFileAsync(output, async () => new Response(Readable.from(['replacement'])))
  ).rejects.toThrow('already exists');
  expect(await fs.readFile(output, 'utf8')).toBe('existing');
});

it('refuses a symlink without changing its target', async () => {
  const target = path.join(directory, 'target');
  await fs.writeFile(target, 'existing');
  await fs.symlink(target, output);
  await expect(
    downloadSimulatorFileAsync(output, async () => new Response(Readable.from(['replacement'])))
  ).rejects.toThrow('already exists');
  expect(await fs.readFile(target, 'utf8')).toBe('existing');
  expect((await fs.lstat(output)).isSymbolicLink()).toBe(true);
});

it('preserves a file created by a competing process during the request', async () => {
  await expect(
    downloadSimulatorFileAsync(output, async () => {
      await fs.writeFile(output, 'competitor');
      return new Response(Readable.from(['replacement']));
    })
  ).rejects.toThrow('already exists');
  expect(await fs.readFile(output, 'utf8')).toBe('competitor');
});

it('removes only its partial file after a body failure', async () => {
  const body = new PassThrough();
  const downloading = downloadSimulatorFileAsync(output, async () => new Response(body));
  body.write('partial');
  while (!(await fs.pathExists(output))) {
    await new Promise(resolve => setImmediate(resolve));
  }
  body.destroy(new Error('secret storage URL'));
  await expect(downloading).rejects.toThrow('Could not save the download');
  expect(await fs.pathExists(output)).toBe(false);
});

it('removes the file when the response fails before the writer opens', async () => {
  const createWriteStream = jest
    .spyOn(fs, 'createWriteStream')
    .mockImplementation((file, options) =>
      nodeFs.createWriteStream(file, {
        ...(typeof options === 'object' ? options : {}),
        fs: {
          ...nodeFs,
          open: (file, flags, mode, callback) => {
            setTimeout(() => {
              nodeFs.open(file, flags, mode, callback);
            }, 50);
          },
        },
      })
    );
  const body = Readable.from(
    (async function* () {
      yield 'partial';
      throw new Error('secret storage URL');
    })()
  );
  const downloading = downloadSimulatorFileAsync(output, async () => new Response(body));
  try {
    await expect(downloading).rejects.toThrow('Could not save the download');
    expect(await fs.readdir(directory)).toEqual([]);
  } finally {
    createWriteStream.mockRestore();
  }
});

it('preserves existing files on request failure', async () => {
  await expect(
    downloadSimulatorFileAsync(output, async () => {
      await fs.writeFile(output, 'existing');
      throw new Error('request failed');
    })
  ).rejects.toThrow('request failed');
  expect(await fs.readFile(output, 'utf8')).toBe('existing');
});

it('follows storage redirects and cancels a real HTTP download with full cleanup', async () => {
  let markClosed: () => void = () => {};
  const closed = new Promise<void>(resolve => {
    markClosed = resolve;
  });
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/body' });
      response.end();
    } else {
      response.once('close', markClosed);
      response.writeHead(200);
      response.write('partial');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/redirect`;
  const listeners = process.listeners('SIGINT');
  try {
    const downloading = downloadSimulatorFileAsync(
      output,
      async signal => await fetch(url, { signal })
    );
    while (!(await fs.pathExists(output))) {
      await new Promise(resolve => setImmediate(resolve));
    }
    process.emit('SIGINT');
    await expect(downloading).rejects.toThrow('canceled');
    await closed;
    expect(await fs.pathExists(output)).toBe(false);
    expect(process.listeners('SIGINT')).toEqual(listeners);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve =>
      server.close(() => {
        resolve();
      })
    );
  }
});
