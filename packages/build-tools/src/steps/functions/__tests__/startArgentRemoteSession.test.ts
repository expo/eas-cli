import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Sentry } from '../../../sentry';
import {
  MIN_ARGENT_REMOTE_SESSION_VERSION,
  stopArgentEventCollectionSafelyAsync,
  waitForArgentToolServerStateAsync,
  warnIfArgentPackageVersionCannotBeVerified,
} from '../startArgentRemoteSession';

jest.mock('../../../sentry');

describe(warnIfArgentPackageVersionCannotBeVerified, () => {
  const warn = jest.fn();
  const logger = { warn } as unknown as bunyan;
  const supportedVersion = '999.0.0';
  const oldVersion = '0.0.0';

  beforeEach(() => {
    warn.mockClear();
  });

  it('allows the default latest package version', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: undefined, logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: 'latest', logger })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('allows exact supported semver versions', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({
        packageVersion: MIN_ARGENT_REMOTE_SESSION_VERSION,
        logger,
      })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: supportedVersion, logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({
        packageVersion: `v${supportedVersion}`,
        logger,
      })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects exact semver versions that are too old', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: oldVersion, logger })
    ).toThrow(SystemError);
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: oldVersion, logger })
    ).toThrow(`Use "latest" or pass an exact version >= ${MIN_ARGENT_REMOTE_SESSION_VERSION}`);
  });

  it('warns for package tags or ranges that cannot be verified', () => {
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion: 'next', logger })
    ).not.toThrow();
    expect(() =>
      warnIfArgentPackageVersionCannotBeVerified({
        packageVersion: `^${MIN_ARGENT_REMOTE_SESSION_VERSION}`,
        logger,
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Continuing and letting the package manager resolve it.')
    );
  });
});

describe(waitForArgentToolServerStateAsync, () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'argent-state-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(stateDir, { recursive: true, force: true });
  });

  function stateJson({ port, pid, token }: { port: number; pid: number; token?: string }): string {
    return JSON.stringify({ port, pid, token });
  }

  it('reports process exit instead of waiting for the startup timeout', async () => {
    const getExitError = jest.fn(() => new Error('server exited with code 1'));
    await expect(
      waitForArgentToolServerStateAsync({
        stateDir,
        ancestorPid: process.pid,
        timeoutMs: 100,
        pollIntervalMs: 1,
        getExitError,
      })
    ).rejects.toThrow('server exited with code 1');
    expect(getExitError).toHaveBeenCalledTimes(1);
  });

  it('detects an exit after polling has begun', async () => {
    const getExitError = jest
      .fn<Error | undefined, []>()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue(new Error('server stopped'));
    await expect(
      waitForArgentToolServerStateAsync({
        stateDir,
        ancestorPid: process.pid,
        timeoutMs: 100,
        pollIntervalMs: 1,
        getExitError,
      })
    ).rejects.toThrow('server stopped');
    expect(getExitError).toHaveBeenCalledTimes(3);
  });

  it('rejects an exit observed while reading a matching state file', async () => {
    await fs.promises.writeFile(
      path.join(stateDir, 'tool-server.json'),
      stateJson({ port: 4321, pid: process.pid })
    );
    const getExitError = jest
      .fn<Error | undefined, []>()
      .mockReturnValueOnce(undefined)
      .mockReturnValue(new Error('server exited during startup'));
    await expect(
      waitForArgentToolServerStateAsync({
        stateDir,
        ancestorPid: process.ppid,
        timeoutMs: 100,
        pollIntervalMs: 1,
        getExitError,
      })
    ).rejects.toThrow('server exited during startup');
    expect(getExitError).toHaveBeenCalledTimes(2);
  });

  it.each(['tool-server.json', 'tool-server-012345abcdef.json'])(
    'reads a matching process from %s',
    async fileName => {
      await fs.promises.writeFile(
        path.join(stateDir, fileName),
        stateJson({ port: 4321, pid: process.pid, token: 'secret' })
      );

      await expect(
        waitForArgentToolServerStateAsync({
          stateDir,
          ancestorPid: process.ppid,
          timeoutMs: 100,
          pollIntervalMs: 1,
        })
      ).resolves.toEqual({ port: 4321, pid: process.pid, token: 'secret' });
    }
  );

  it('selects the state whose pid belongs to the launched process tree', async () => {
    await fs.promises.writeFile(
      path.join(stateDir, 'tool-server-111111111111.json'),
      stateJson({ port: 1111, pid: Number.MAX_SAFE_INTEGER })
    );
    await fs.promises.writeFile(
      path.join(stateDir, 'tool-server-222222222222.json'),
      stateJson({ port: 2222, pid: process.pid })
    );

    await expect(
      waitForArgentToolServerStateAsync({
        stateDir,
        ancestorPid: process.ppid,
        timeoutMs: 100,
        pollIntervalMs: 1,
      })
    ).resolves.toEqual({ port: 2222, pid: process.pid });
  });

  it('does not return a state file outside the launched process tree', async () => {
    const filePath = path.join(stateDir, 'tool-server-012345abcdef.json');
    await fs.promises.writeFile(filePath, stateJson({ port: 1111, pid: Number.MAX_SAFE_INTEGER }));

    await expect(
      waitForArgentToolServerStateAsync({
        stateDir,
        ancestorPid: process.pid,
        timeoutMs: 10,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow(`state file belonging to process ${process.pid}`);
  });
});

describe(stopArgentEventCollectionSafelyAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports an unexpected stop failure without rejecting', async () => {
    const error = new Error('stop failed');
    const logger = { warn: jest.fn() } as unknown as bunyan;

    await expect(
      stopArgentEventCollectionSafelyAsync({
        eventCollection: { stopAsync: jest.fn().mockRejectedValue(error) },
        deviceRunSessionId: 'session-id',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not finish argent session event collection',
      error,
      {
        level: 'warning',
        tags: { phase: 'argent-event-collection', operation: 'stop' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'Could not finish argent session event collection.'
    );
  });
});
