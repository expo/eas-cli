import downloadFile from '@expo/downloader';
import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { resolveLatestDevicePackageAsync } from '../devicePackageMirror';

jest.mock('@expo/downloader', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../sentry');

const MIRROR = 'https://storage.googleapis.com/turtle-v2/npm';
const HUB_TARBALL = Buffer.from('expo-device-hub 0.24.0 tarball');
const NPM_TARBALL = Buffer.from('expo-device-hub 0.24.1 tarball from npm');

function integrityOf(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function hubPointer(overrides: Record<string, unknown> = {}) {
  return {
    name: 'expo-device-hub',
    version: '0.24.0',
    tarball: '-/expo-device-hub-0.24.0.tgz',
    integrity: integrityOf(HUB_TARBALL),
    shasum: 'ff556b0858baea6125fe07bcb86c1441d41c80aa',
    ...overrides,
  };
}

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const env = { PATH: '/usr/bin' } as BuildStepEnv;
const mockedFetch = jest.mocked(turtleFetch);
const mockedDownload = jest.mocked(downloadFile);
const mockedSpawn = jest.mocked(spawn);

/** Serves the pointer at `<mirror>/<name>/latest.json`; a missing entry is an HTTP 404. */
function servePointers(pointers: Record<string, unknown>) {
  mockedFetch.mockImplementation((async (url: string) => {
    if (!(url in pointers)) {
      throw new Error(`Request failed with status 404 (${url})`);
    }
    return { json: async () => pointers[url] };
  }) as unknown as typeof turtleFetch);
}

/** Writes the given bytes for each URL; a missing URL fails like a failed download. */
function serveFiles(files: Record<string, Buffer>) {
  mockedDownload.mockImplementation(async (url, outputPath) => {
    const bytes = files[url];
    if (!bytes) {
      throw new Error(`Failed to download the file: 404 (${url})`);
    }
    await fs.promises.writeFile(outputPath, bytes);
  });
}

/** Each call answers like `npm pack <spec> --json`: an Error rejects, a Buffer writes a tarball. */
function npmPackAnswers(...answers: (Error | Buffer)[]) {
  for (const answer of answers) {
    mockedSpawn.mockImplementationOnce((async (
      _command: string,
      args: string[]
    ): Promise<{ stdout: string }> => {
      if (answer instanceof Error) {
        throw answer;
      }
      const destination = args[args.indexOf('--pack-destination') + 1];
      await fs.promises.writeFile(path.join(destination, 'expo-device-hub-0.24.1.tgz'), answer);
      return {
        stdout: JSON.stringify([
          {
            name: 'expo-device-hub',
            version: '0.24.1',
            filename: 'expo-device-hub-0.24.1.tgz',
            integrity: integrityOf(answer),
          },
        ]),
      };
    }) as unknown as typeof spawn);
  }
}

function resolveAsync(options: { packageName?: string; env?: BuildStepEnv; signal?: AbortSignal }) {
  return resolveLatestDevicePackageAsync({
    packageName: 'expo-device-hub',
    env,
    logger,
    npmRetryDelaysMs: [1, 1],
    ...options,
  });
}

function localPathOf(packageSpec: string): string {
  expect(packageSpec).toMatch(/^file:/);
  return packageSpec.slice('file:'.length);
}

describe(resolveLatestDevicePackageAsync, () => {
  it('runs the mirrored tarball after its sha512 matches the pointer', async () => {
    servePointers({ [`${MIRROR}/expo-device-hub/latest.json`]: hubPointer() });
    serveFiles({ [`${MIRROR}/expo-device-hub/-/expo-device-hub-0.24.0.tgz`]: HUB_TARBALL });

    const resolved = await resolveAsync({});

    expect(resolved).toEqual({
      packageSpec: expect.stringMatching(/eas-device-package-.*\/expo-device-hub-0\.24\.0\.tgz$/),
      description: 'expo-device-hub@0.24.0 from the EAS package mirror',
      source: 'mirror',
      version: '0.24.0',
    });
    const tarballPath = localPathOf(resolved.packageSpec);
    expect(tarballPath.startsWith(os.tmpdir())).toBe(true);
    expect(await fs.promises.readFile(tarballPath)).toEqual(HUB_TARBALL);
    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Using expo-device-hub@0.24.0 from the EAS package mirror.'
    );
  });

  it('reads a scoped package from its npm directory layout', async () => {
    const serveSim = Buffer.from('serve-sim 0.14.3');
    servePointers({
      [`${MIRROR}/@expo/serve-sim/latest.json`]: hubPointer({
        name: '@expo/serve-sim',
        version: '0.14.3',
        tarball: '-/serve-sim-0.14.3.tgz',
        integrity: integrityOf(serveSim),
      }),
    });
    serveFiles({ [`${MIRROR}/@expo/serve-sim/-/serve-sim-0.14.3.tgz`]: serveSim });

    const resolved = await resolveAsync({ packageName: '@expo/serve-sim' });

    expect(resolved.source).toBe('mirror');
    expect(localPathOf(resolved.packageSpec)).toMatch(/\/serve-sim-0\.14\.3\.tgz$/);
  });

  it('reads the mirror from the step env value instead of the default bucket', async () => {
    servePointers({ ['https://mirror.test/npm/expo-device-hub/latest.json']: hubPointer() });
    serveFiles({
      ['https://mirror.test/npm/expo-device-hub/-/expo-device-hub-0.24.0.tgz']: HUB_TARBALL,
    });

    const resolved = await resolveAsync({
      env: { ...env, EAS_DEVICE_PACKAGE_MIRROR_URL: 'https://mirror.test/npm/' },
    });

    expect(resolved.source).toBe('mirror');
  });

  it('downloads the tarball through the cache proxy, but never the pointer', async () => {
    const proxied =
      'https://cache.example.com/storage.googleapis.com/turtle-v2/npm/expo-device-hub/-/expo-device-hub-0.24.0.tgz';
    servePointers({ [`${MIRROR}/expo-device-hub/latest.json`]: hubPointer() });
    serveFiles({ [proxied]: HUB_TARBALL });

    const resolved = await resolveAsync({
      env: { ...env, EAS_BUILD_COCOAPODS_CACHE_URL: 'https://cache.example.com/' },
    });

    expect(resolved.source).toBe('mirror');
    expect(mockedFetch).toHaveBeenCalledWith(
      `${MIRROR}/expo-device-hub/latest.json`,
      'GET',
      expect.anything()
    );
    expect(mockedDownload.mock.calls.map(([url]) => url)).toEqual([proxied]);
  });

  it('downloads the tarball directly when the cache proxy fails', async () => {
    servePointers({ [`${MIRROR}/expo-device-hub/latest.json`]: hubPointer() });
    serveFiles({ [`${MIRROR}/expo-device-hub/-/expo-device-hub-0.24.0.tgz`]: HUB_TARBALL });

    const resolved = await resolveAsync({
      env: { ...env, EAS_BUILD_COCOAPODS_CACHE_URL: 'https://cache.example.com' },
    });

    expect(resolved.source).toBe('mirror');
    expect(mockedDownload).toHaveBeenCalledTimes(2);
  });

  it('downloads the latest release from npm when the mirror has no pointer', async () => {
    servePointers({});
    npmPackAnswers(NPM_TARBALL);

    const resolved = await resolveAsync({});

    expect(resolved).toEqual({
      packageSpec: expect.stringMatching(/\/expo-device-hub-0\.24\.1\.tgz$/),
      description: 'expo-device-hub@0.24.1 from npm',
      source: 'npm',
      version: '0.24.1',
    });
    expect(await fs.promises.readFile(localPathOf(resolved.packageSpec))).toEqual(NPM_TARBALL);
    expect(mockedSpawn).toHaveBeenCalledWith(
      'npm',
      [
        'pack',
        'expo-device-hub@latest',
        '--pack-destination',
        expect.stringContaining('eas-device-package-'),
        '--json',
      ],
      expect.objectContaining({ env, stdio: 'pipe' })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Could not use expo-device-hub from the EAS package mirror. Downloading expo-device-hub@latest from npm.'
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not use expo-device-hub from the EAS package mirror',
      expect.any(Error),
      { level: 'warning', tags: { packageName: 'expo-device-hub' } }
    );
  });

  it('drops a mirrored tarball whose sha512 does not match and uses npm', async () => {
    servePointers({ [`${MIRROR}/expo-device-hub/latest.json`]: hubPointer() });
    serveFiles({ [`${MIRROR}/expo-device-hub/-/expo-device-hub-0.24.0.tgz`]: Buffer.from('bad') });
    npmPackAnswers(NPM_TARBALL);

    const resolved = await resolveAsync({});

    expect(resolved.source).toBe('npm');
    const directory = path.dirname(localPathOf(resolved.packageSpec));
    expect(await fs.promises.readdir(directory)).toEqual(['expo-device-hub-0.24.1.tgz']);
    expect(String(jest.mocked(logger.warn).mock.calls[0][0].err)).toContain('not sha512-');
  });

  it('uses npm when the pointer names another package', async () => {
    servePointers({
      [`${MIRROR}/expo-device-hub/latest.json`]: hubPointer({ name: '@expo/serve-sim' }),
    });
    npmPackAnswers(NPM_TARBALL);

    const resolved = await resolveAsync({});

    expect(resolved.source).toBe('npm');
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('tries npm again when the new release is not downloadable yet', async () => {
    servePointers({});
    npmPackAnswers(new Error('npm error code E404'), NPM_TARBALL);

    const resolved = await resolveAsync({});

    expect(resolved.description).toBe('expo-device-hub@0.24.1 from npm');
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('leaves expo-device-hub@latest to the package manager when npm keeps failing', async () => {
    servePointers({});
    npmPackAnswers(
      new Error('npm error code E404'),
      new Error('npm error code E404'),
      new Error('npm error code E404')
    );

    const resolved = await resolveAsync({});

    expect(resolved).toEqual({
      packageSpec: 'expo-device-hub@latest',
      description: 'expo-device-hub@latest',
      source: 'npm',
    });
    expect(mockedSpawn).toHaveBeenCalledTimes(3);
  });

  it('stops without a fallback when the startup is aborted', async () => {
    const controller = new AbortController();
    mockedFetch.mockImplementation((async () => {
      controller.abort(new Error('Session stopped.'));
      throw new Error('aborted');
    }) as unknown as typeof turtleFetch);

    await expect(resolveAsync({ signal: controller.signal })).rejects.toThrow('Session stopped.');

    expect(mockedSpawn).not.toHaveBeenCalled();
  });
});
