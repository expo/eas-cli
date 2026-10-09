import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, BuildStepEnv, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clearTimeout as clearTimeoutCallback,
  setTimeout as setTimeoutCallback,
} from 'node:timers';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  IosSimulatorRecordingUtils,
  SERVE_SIM_STOP_GRACE_PERIOD_MS,
} from '../IosSimulatorRecordingUtils';
import * as remoteDeviceRunSession from '../remoteDeviceRunSession';
import { readServeSimServersAsync } from '../serveSimMetricsRecorder';
import { sleepAsync } from '../../../utils/retry';
import { uploadDeviceRunSessionScreenRecordingsAsync } from '../deviceRunSessionScreenRecordings';
import {
  createServeSimLaunchInputProviders,
  describeServeSimLaunch,
  ensureFfmpegInstalledOnceAsync,
  fetchWebPreviewTurnArgsAsync,
  parseServeSimLaunchInputs,
  spawnDetached,
  startNgrokTunnelAsync,
  turnIceServersToWebPreviewArgs,
  waitForDeviceRunSessionStoppedAsync,
} from '../remoteDeviceRunSession';

import {
  createExpoDeviceHubArgs,
  createServeSimArgs,
  simulatorPreviewPageUrl,
  startDeviceSessionHostAsync,
  waitForWebPreviewReadyAsync,
  websiteOrigin,
  websiteOriginServeSimArgs,
} from '../deviceSessionHost';
import { parseNetworkCaptureFieldsInput, parseNetworkCaptureInputs } from '../networkCaptureFields';

jest.mock('@ngrok/ngrok');
jest.mock('node:timers');
jest.mock('node:timers/promises');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../utils/retry', () => ({ sleepAsync: jest.fn() }));
jest.mock('../../../sentry');
jest.mock('@expo/turtle-spawn');
jest.mock('../deviceRunSessionScreenRecordings', () => ({
  ...jest.requireActual('../deviceRunSessionScreenRecordings'),
  uploadDeviceRunSessionScreenRecordingsAsync: jest.fn(),
}));
// Spyable so a test can stand in for the serve-sim state directory, which a local serve-sim owns.
jest.mock('../serveSimMetricsRecorder', () => {
  const actual = jest.requireActual('../serveSimMetricsRecorder');
  return { ...actual, readServeSimServersAsync: jest.fn(actual.readServeSimServersAsync) };
});

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as bunyan;
}

describe(spawnDetached, () => {
  function mockProcess(promise: Promise<unknown>): void {
    jest
      .mocked(spawn)
      .mockReturnValue(
        Object.assign(promise, { child: { pid: 1234, unref: jest.fn(), once: jest.fn() } }) as never
      );
  }

  it('observes exit without waiting for inherited output pipes to close', () => {
    const child = Object.assign(new EventEmitter(), { pid: 1234, unref: jest.fn() });
    jest.mocked(spawn).mockReturnValue(Object.assign(new Promise(() => {}), { child }) as never);
    const handle = spawnDetached({ command: 'server', args: [], env: {} });
    child.emit('exit', 1, null);
    expect(handle.getExitError()?.message).toContain('code 1');
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('does not report an exit while the process is running', () => {
    mockProcess(new Promise(() => {}));
    const handle = spawnDetached({ command: 'server', args: [], env: {} });
    expect(handle.getExitError()).toBeUndefined();
  });

  it('reports a clean exit so startup does not keep waiting', async () => {
    const completion = Promise.resolve();
    mockProcess(completion);
    const handle = spawnDetached({ command: 'server', args: [], env: {} });
    await completion;
    expect(handle.getExitError()?.message).toContain('code 0');
  });

  it.each([0, 1])('observes a real subprocess exiting with code %s', async exitCode => {
    const actualSpawn =
      jest.requireActual<typeof import('@expo/turtle-spawn')>('@expo/turtle-spawn').default;
    let completion: ReturnType<typeof actualSpawn>;
    jest.mocked(spawn).mockImplementationOnce((...args) => {
      completion = actualSpawn(...args);
      return completion;
    });
    const handle = spawnDetached({
      command: process.execPath,
      args: ['-e', `console.error('startup-marker'); process.exit(${exitCode});`],
      env: {},
    });
    await completion!.catch(() => {});
    expect(handle.getExitError()).toBeInstanceOf(Error);
    expect(handle.getOutput()).toContain('startup-marker');
  });

  it.each(['spawn ENOENT', 'server exited with code 1', 'server terminated by SIGTERM'])(
    'preserves the process failure: %s',
    async message => {
      const error = new Error(message);
      const completion = Promise.reject(error);
      mockProcess(completion);
      const handle = spawnDetached({ command: 'server', args: [], env: {} });
      await completion.catch(() => {});
      expect(handle.getExitError()).toBe(error);
    }
  );
});

function createCtxMock(): CustomBuildContext {
  return {
    env: {
      __API_SERVER_URL: 'https://api.expo.test',
    },
    job: {
      secrets: { robotAccessToken: 'robot-token' },
    },
  } as unknown as CustomBuildContext;
}

function createStatusCtxMock(
  results: (
    | { status: 'NEW' | 'IN_PROGRESS' | 'STOPPED' | 'ERRORED' }
    | { error: Error }
    | { data: unknown }
  )[],
  { ensureStoppedError }: { ensureStoppedError?: Error } = {}
): CustomBuildContext {
  const query = jest.fn(() => {
    const result = results.shift();
    if (!result) {
      throw new Error('No mocked status result available');
    }
    return {
      toPromise: async () => {
        if ('error' in result) {
          throw result.error;
        }
        if ('data' in result) {
          return { data: result.data };
        }
        return {
          data: {
            deviceRunSessions: {
              byId: {
                id: 'drs-id',
                status: result.status,
              },
            },
          },
        };
      },
    };
  });

  const mutation = jest.fn(() => ({
    toPromise: async () => {
      if (ensureStoppedError) {
        return { error: ensureStoppedError };
      }
      return {
        data: {
          deviceRunSession: {
            ensureDeviceRunSessionStopped: { id: 'drs-id', status: 'STOPPED' },
          },
        },
      };
    },
  }));

  return {
    graphqlClient: {
      query,
      mutation,
    },
  } as unknown as CustomBuildContext;
}

function createEnvMock(): BuildStepEnv {
  return { DEVICE_RUN_SESSION_ID: 'drs-id' } as unknown as BuildStepEnv;
}

describe(createServeSimLaunchInputProviders, () => {
  it('declares the launch inputs as optional', () => {
    const globalCtx = createGlobalContextMock();
    const inputs = createServeSimLaunchInputProviders().map(provider =>
      provider(globalCtx, 'Test step')
    );

    expect(
      inputs.map(({ id, required, allowedValueTypeName }) => ({
        id,
        required,
        allowedValueTypeName,
      }))
    ).toEqual([
      {
        id: 'launch_app_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      },
      {
        id: 'launch_args',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      },
      {
        id: 'open_url',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      },
    ]);
  });
});

describe(parseServeSimLaunchInputs, () => {
  const darwin = { runtimePlatform: BuildRuntimePlatform.DARWIN };

  it('reads the launch identifier, arguments and URL', () => {
    expect(
      parseServeSimLaunchInputs(
        {
          launchAppIdentifier: 'host.exp.Exponent',
          launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
          openUrl: 'exp://127.0.0.1:8081',
        },
        darwin
      )
    ).toEqual({
      launchAppIdentifier: 'host.exp.Exponent',
      launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
      openUrl: 'exp://127.0.0.1:8081',
    });
  });

  it('defaults to no launch when the step declares nothing', () => {
    expect(parseServeSimLaunchInputs({}, { runtimePlatform: BuildRuntimePlatform.LINUX })).toEqual({
      launchAppIdentifier: undefined,
      launchArgs: [],
      openUrl: undefined,
    });
  });

  it('rejects launch arguments that are not a list', () => {
    expect(() =>
      parseServeSimLaunchInputs(
        {
          launchAppIdentifier: 'host.exp.Exponent',
          launchArgs: 'oops',
        },
        darwin
      )
    ).toThrow('must be an array of strings');
  });

  it('rejects launch arguments that are not all strings', () => {
    expect(() =>
      parseServeSimLaunchInputs(
        {
          launchAppIdentifier: 'host.exp.Exponent',
          launchArgs: ['-flag', 1],
        },
        darwin
      )
    ).toThrow('must be an array of strings');
  });

  it('rejects launch arguments with no application to launch', () => {
    expect(() => parseServeSimLaunchInputs({ launchArgs: ['-flag'] }, darwin)).toThrow(
      'Pass "launch_app_identifier"'
    );
  });

  it('rejects a URL with no application to open it in', () => {
    expect(() => parseServeSimLaunchInputs({ openUrl: 'exp://127.0.0.1:8081' }, darwin)).toThrow(
      'Pass "launch_app_identifier"'
    );
  });

  it('rejects an identifier that resolved to an empty string', () => {
    expect(() => parseServeSimLaunchInputs({ launchAppIdentifier: '' }, darwin)).toThrow(
      'must be a non-empty string'
    );
  });

  it('rejects a URL that is not a URL', () => {
    expect(() =>
      parseServeSimLaunchInputs(
        { launchAppIdentifier: 'host.exp.Exponent', openUrl: 'not a url' },
        darwin
      )
    ).toThrow('must be a valid URL');
  });

  it('raises a user error, not a platform error', () => {
    expect(() => parseServeSimLaunchInputs({ launchAppIdentifier: '' }, darwin)).toThrow(UserError);
    try {
      parseServeSimLaunchInputs({ launchAppIdentifier: '' }, darwin);
    } catch (error) {
      expect((error as UserError).errorCode).toBe('EAS_LAUNCH_APPLICATION_INVALID_INPUT');
    }
  });

  it('rejects a launch on a session that does not run an iOS simulator', () => {
    expect(() =>
      parseServeSimLaunchInputs(
        { launchAppIdentifier: 'host.exp.Exponent' },
        { runtimePlatform: BuildRuntimePlatform.LINUX }
      )
    ).toThrow('runs on linux');
  });
});

describe(describeServeSimLaunch, () => {
  it('says nothing when there is no application to launch', () => {
    expect(describeServeSimLaunch({ launchArgs: [] })).toBeNull();
  });

  it('names only the application when there are no arguments or URL', () => {
    expect(describeServeSimLaunch({ launchAppIdentifier: 'host.exp.Exponent' })).toBe(
      'serve-sim will launch host.exp.Exponent.'
    );
  });

  it('names the application, its arguments and the URL', () => {
    expect(
      describeServeSimLaunch({
        launchAppIdentifier: 'host.exp.Exponent',
        launchArgs: ['-flag', '1'],
        openUrl: 'exp://127.0.0.1:8081',
      })
    ).toBe(
      'serve-sim will launch host.exp.Exponent with arguments ["-flag","1"], then open exp://127.0.0.1:8081.'
    );
  });
});

describe(createServeSimArgs, () => {
  it('uses the latest Expo package and applies the EAS streaming policy', () => {
    expect(
      createServeSimArgs({
        port: 4321,
        turnArgs: ['--turn-url', 'turns:turn.example.test:443'],
      })
    ).toEqual([
      '@expo/serve-sim@latest',
      '--port',
      '4321',
      '--host',
      '127.0.0.1',
      '--require-token',
      '--transport',
      'webrtc',
      '--webrtc-codec',
      'h264',
      '--max-dimension',
      '1600',
      '--mjpeg-quality',
      '0.55',
      '--video-bitrate',
      '10000000',
      '--video-fps',
      '60',
      '--turn-url',
      'turns:turn.example.test:443',
    ]);
  });

  it('appends the website args after the TURN args when provided', () => {
    const args = createServeSimArgs({
      port: 4321,
      turnArgs: ['--turn-url', 'turns:turn.example.test:443'],
      websiteArgs: ['--cors-origin', 'https://expo.dev'],
    });
    expect(args.slice(-4)).toEqual([
      '--turn-url',
      'turns:turn.example.test:443',
      '--cors-origin',
      'https://expo.dev',
    ]);
  });

  it('pins the requested package version', () => {
    expect(createServeSimArgs({ port: 4321, packageVersion: '0.1.38' })[0]).toBe(
      '@expo/serve-sim@0.1.38'
    );
  });

  it('pins a dist-tag', () => {
    expect(createServeSimArgs({ port: 4321, packageVersion: 'next' })[0]).toBe(
      '@expo/serve-sim@next'
    );
  });

  it('appends --share-url after the website args', () => {
    const args = createServeSimArgs({
      port: 4321,
      websiteArgs: ['--cors-origin', 'https://expo.dev', '--frame-ancestor', 'https://expo.dev'],
      shareUrl: 'https://expo.dev/simulator-preview/abc',
    });
    expect(args.slice(-4)).toEqual([
      '--frame-ancestor',
      'https://expo.dev',
      '--share-url',
      'https://expo.dev/simulator-preview/abc',
    ]);
  });

  it('appends the launch flags after the streaming policy', () => {
    const args = createServeSimArgs({
      port: 4321,
      launchAppIdentifier: 'host.exp.Exponent',
      launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
      openUrl: 'exp://127.0.0.1:8081',
    });
    expect(args.slice(-8)).toEqual([
      '--launch-app-identifier',
      'host.exp.Exponent',
      '--launch-arg',
      '-EXDevMenuIsOnboardingFinished',
      '--launch-arg',
      '1',
      '--open-url',
      'exp://127.0.0.1:8081',
    ]);
  });

  it('omits the launch flags when there is no application to launch', () => {
    const args = createServeSimArgs({ port: 4321 });
    expect(args.some(argument => argument.startsWith('--launch'))).toBe(false);
    expect(args).not.toContain('--open-url');
  });

  it('omits --network-capture by default', () => {
    expect(createServeSimArgs({ port: 4321 })).not.toContain('--network-capture');
    expect(createServeSimArgs({ port: 4321, networkCapture: false })).not.toContain(
      '--network-capture'
    );
  });

  it('appends --network-capture when enabled, which also covers an already booted simulator', () => {
    const args = createServeSimArgs({ port: 4321, networkCapture: true });
    expect(args).toContain('--network-capture');
    expect(args).not.toContain('--enable');
  });

  it('repeats --network-capture-field once per requested field', () => {
    expect(
      createServeSimArgs({
        port: 4321,
        networkCapture: true,
        networkCaptureFields: ['header', 'query'],
      })
    ).toEqual(
      expect.arrayContaining([
        '--network-capture',
        '--network-capture-field',
        'header',
        '--network-capture-field',
        'query',
      ])
    );
  });

  it('keeps capture metadata-only when no field is requested', () => {
    expect(createServeSimArgs({ port: 4321, networkCapture: true })).not.toContain(
      '--network-capture-field'
    );
  });

  it('does not pass fields when capture itself is off', () => {
    expect(
      createServeSimArgs({ port: 4321, networkCapture: false, networkCaptureFields: ['header'] })
    ).not.toContain('--network-capture-field');
  });

  it('rejects network capture on a runtime that has no serve-sim', () => {
    expect(() =>
      parseNetworkCaptureInputs(
        { networkCapture: true },
        { runtimePlatform: BuildRuntimePlatform.LINUX }
      )
    ).toThrow('this session runs on linux');
    expect(() =>
      parseNetworkCaptureInputs(
        { networkCaptureFields: ['header'] },
        { runtimePlatform: BuildRuntimePlatform.DARWIN }
      )
    ).toThrow('needs "network_capture: true"');
    expect(parseNetworkCaptureInputs({}, { runtimePlatform: BuildRuntimePlatform.LINUX })).toEqual({
      networkCapture: false,
      networkCaptureFields: [],
    });
    expect(
      parseNetworkCaptureInputs(
        { networkCapture: true, networkCaptureFields: ['header'] },
        { runtimePlatform: BuildRuntimePlatform.DARWIN }
      )
    ).toEqual({ networkCapture: true, networkCaptureFields: ['header'] });
  });

  it('rejects a step input that is not an array of strings', () => {
    // A JSON step input is whatever the workflow author wrote, so the shape has to be checked.
    expect(() => parseNetworkCaptureFieldsInput('header,query')).toThrow(UserError);
    expect(() => parseNetworkCaptureFieldsInput('header,query')).toThrow(
      /must be an array of strings/
    );
    expect(() => parseNetworkCaptureFieldsInput([1, 2])).toThrow(UserError);
    expect(parseNetworkCaptureFieldsInput(undefined)).toEqual([]);
    expect(parseNetworkCaptureFieldsInput(['header'])).toEqual(['header']);
  });
});

describe(createExpoDeviceHubArgs, () => {
  it('opts in to recording only when a directory is provided', () => {
    expect(createExpoDeviceHubArgs({ port: 4321 })).not.toContain('--android-recording-directory');
    expect(
      createExpoDeviceHubArgs({ port: 4321, recordingDirectory: '/tmp/recordings' }).slice(-2)
    ).toEqual(['--android-recording-directory', '/tmp/recordings']);
  });
  it('uses the latest Expo package and applies the EAS Android streaming policy', () => {
    expect(
      createExpoDeviceHubArgs({
        port: 4321,
        turnArgs: ['--turn-url', 'turns:turn.example.test:443'],
      })
    ).toEqual([
      'expo-device-hub@latest',
      '--port',
      '4321',
      '--host',
      '127.0.0.1',
      '--platform',
      'android',
      '--transport',
      'webrtc',
      '--webrtc-codec',
      'h264',
      '--webrtc-ice-policy',
      'all',
      '--max-dimension',
      '960',
      '--video-bitrate',
      '6000000',
      '--video-fps',
      '60',
      '--hide-sidebar',
      '--hide-boot-device',
      '--turn-url',
      'turns:turn.example.test:443',
    ]);
  });

  it('pins the requested package version', () => {
    expect(createExpoDeviceHubArgs({ port: 4321, packageVersion: '0.7.0' })[0]).toBe(
      'expo-device-hub@0.7.0'
    );
  });
});

describe(websiteOriginServeSimArgs, () => {
  it('names only the production website by default', () => {
    expect(websiteOriginServeSimArgs({} as BuildStepEnv)).toEqual([
      '--cors-origin',
      'https://expo.dev',
      '--frame-ancestor',
      'https://expo.dev',
    ]);
  });

  it('names staging, its deploy previews and local website subdomains on staging', () => {
    const args = websiteOriginServeSimArgs({ EXPO_STAGING: '1' } as BuildStepEnv);
    expect(args).toEqual([
      '--cors-origin',
      'https://staging.expo.dev',
      '--frame-ancestor',
      'https://staging.expo.dev',
      '--cors-origin',
      'https://*.expo.dev',
      '--frame-ancestor',
      'https://*.expo.dev',
      '--cors-origin',
      'https://expo.test',
      '--frame-ancestor',
      'https://expo.test',
      '--cors-origin',
      'https://*.expo.test',
      '--frame-ancestor',
      'https://*.expo.test',
    ]);
  });

  it('names only https origins', () => {
    for (const env of [{}, { EXPO_STAGING: '1' }, { EXPO_LOCAL: '1' }]) {
      const args = websiteOriginServeSimArgs(env as BuildStepEnv);
      expect(args.filter(value => value.startsWith('http://'))).toEqual([]);
    }
  });

  it('names local website subdomains without the deploy-preview wildcard on local', () => {
    for (const env of [{ EXPO_LOCAL: '1' }, { EXPO_LOCAL: '1', EXPO_STAGING: '1' }]) {
      expect(websiteOriginServeSimArgs(env as BuildStepEnv)).toEqual([
        '--cors-origin',
        'https://expo.test',
        '--frame-ancestor',
        'https://expo.test',
        '--cors-origin',
        'https://*.expo.test',
        '--frame-ancestor',
        'https://*.expo.test',
      ]);
    }
  });
});

describe(waitForWebPreviewReadyAsync, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
    jest.mocked(sleepAsync).mockReset();
    jest.mocked(sleepAsync).mockResolvedValue(undefined);
  });

  it('waits for the stable readiness endpoint', async () => {
    jest
      .mocked(turtleFetch)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({
        json: async () => ({ status: 'ready', device: 'DEVICE-A' }),
      } as unknown as Awaited<ReturnType<typeof turtleFetch>>);

    await waitForWebPreviewReadyAsync({
      previewServer: { pid: undefined, getOutput: () => '' },
      serverName: 'expo-device-hub',
      port: 4321,
      timeoutMs: 10_000,
    });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(2);
    expect(jest.mocked(turtleFetch)).toHaveBeenLastCalledWith(
      'http://127.0.0.1:4321/readyz',
      'GET',
      expect.objectContaining({ retries: 0 })
    );
    expect(sleepAsync).toHaveBeenCalledTimes(1);
    expect(sleepAsync).toHaveBeenCalledWith(250);
  });
});

describe(startNgrokTunnelAsync, () => {
  it.each(['rejected', 'stalled'] as const)(
    'retains a %s close failure on repeated stops',
    async mode => {
      jest.useFakeTimers();
      try {
        const failure = new Error('close failed');
        const close = jest
          .fn()
          .mockImplementation(() =>
            mode === 'rejected' ? Promise.reject(failure) : new Promise<void>(() => {})
          );
        jest.mocked(ngrok.forward).mockResolvedValue({
          url: () => 'https://web-preview.example.test',
          close,
        } as never);
        const tunnel = await startNgrokTunnelAsync({
          port: 4321,
          subdomainPrefix: 'web-preview',
          baseDomain: 'eas-simulator.ngrok.dev',
          authtoken: 'token',
          logger: createLoggerMock(),
        });
        const stopping = tunnel.stopAsync();
        const assertion = expect(stopping).rejects.toThrow(
          mode === 'rejected' ? 'close failed' : 'Ngrok tunnel stop timed out after 4000ms.'
        );
        expect(tunnel.stopAsync()).toBe(stopping);
        await jest.advanceTimersByTimeAsync(4_000);
        await assertion;
        await expect(tunnel.stopAsync()).rejects.toThrow();
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it('uses a 128-bit capability hostname and exposes explicit cleanup', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://web-preview.example.test',
      close,
    } as never);

    const tunnel = await startNgrokTunnelAsync({
      port: 4321,
      subdomainPrefix: 'web-preview',
      baseDomain: 'eas-simulator.ngrok.dev',
      authtoken: 'token',
      logger: createLoggerMock(),
    });

    expect(ngrok.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        addr: 4321,
        authtoken: 'token',
        domain: expect.stringMatching(/^web-preview-[a-f0-9]{32}\.eas-simulator\.ngrok\.dev$/),
      })
    );
    expect(tunnel.url).toBe('https://web-preview.example.test');
    expect(ngrok.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: `web-preview-${tunnel.subdomainId}.eas-simulator.ngrok.dev`,
      })
    );
    await tunnel.stopAsync();
    await tunnel.stopAsync();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('spawnDetached process group shutdown', () => {
  const env = {} as BuildStepEnv;

  beforeEach(() => {
    const spawned = Object.assign(Promise.resolve(undefined), {
      child: {
        pid: 4321,
        unref: jest.fn(),
        once: jest.fn((event, callback) => {
          if (event === 'close') {
            queueMicrotask(callback);
          }
        }),
      },
    });
    jest.mocked(spawn).mockReturnValue(spawned as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waits for a detached child after its package-manager wrapper exits', async () => {
    let groupChecks = 0;
    const kill = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -4321 && signal === 0) {
        groupChecks += 1;
        if (groupChecks < 4) {
          return true;
        }
        throw new Error('Process group exited');
      }
      if (pid === -4321 && signal === 'SIGTERM') {
        return true;
      }
      throw new Error(`Unexpected process signal: ${pid} ${signal}`);
    });

    const detached = spawnDetached({ command: 'npx', args: [], env, stopGracePeriodMs: 90_000 });
    await detached.stopAsync();

    expect(jest.mocked(sleepAsync)).toHaveBeenCalledWith(100);
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(kill).not.toHaveBeenCalledWith(4321, 0);
  });

  it('kills a detached child that outlives the shutdown deadline', async () => {
    let killed = false;
    const kill = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -4321 && signal === 'SIGKILL') {
        killed = true;
      }
      if (killed && signal === 0) {
        throw Object.assign(new Error('Process group exited'), { code: 'ESRCH' });
      }
      return true;
    });

    const detached = spawnDetached({ command: 'npx', args: [], env, stopGracePeriodMs: 0 });
    await detached.stopAsync();

    expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
  });
});

describe(startDeviceSessionHostAsync, () => {
  const baseDomain = 'eas-simulator.ngrok.dev';
  const turnArgs = [
    '--turn-url',
    'turns:turn.example.test:443',
    '--turn-username',
    'turn-user',
    '--turn-credential',
    'turn-credential',
  ];
  const websiteArgs = ['--cors-origin', 'https://expo.dev', '--frame-ancestor', 'https://expo.dev'];
  const env = {
    DEVICE_RUN_SESSION_ID: 'drs-id',
    NGROK_AUTHTOKEN: 'ngrok-token',
  } as unknown as BuildStepEnv;

  beforeEach(() => {
    jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockReset();
    jest.mocked(spawn).mockReset();
    jest.mocked(ngrok.forward).mockReset();
    jest.mocked(turtleFetch).mockReset();
    jest
      .mocked(readServeSimServersAsync)
      .mockResolvedValue([{ udid: 'device-id', url: 'http://127.0.0.1:1', token: 'tok-1' }]);

    const spawnPromise = Object.assign(Promise.resolve(undefined), {
      child: {
        pid: undefined,
        unref: jest.fn(),
        once: jest.fn((event, callback) => {
          if (event === 'close') {
            queueMicrotask(callback);
          }
        }),
      },
    });
    jest.mocked(spawn).mockReturnValue(spawnPromise as never);

    jest.mocked(turtleFetch).mockImplementation(async url => {
      if (url.endsWith('/turn-ice-servers')) {
        return {
          json: async () => ({
            data: {
              iceServers: [
                {
                  urls: ['turns:turn.example.test:443'],
                  username: 'turn-user',
                  credential: 'turn-credential',
                },
              ],
            },
          }),
        } as unknown as Awaited<ReturnType<typeof turtleFetch>>;
      }
      return {
        json: async () => ({ status: 'ready', device: 'device-id' }),
      } as unknown as Awaited<ReturnType<typeof turtleFetch>>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives serve-sim its recording grace period on shutdown', async () => {
    const spawnDetachedSpy = jest.spyOn(remoteDeviceRunSession, 'spawnDetached');
    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
    });

    expect(spawnDetachedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stopGracePeriodMs: SERVE_SIM_STOP_GRACE_PERIOD_MS })
    );
    await host.finishAsync();
  });

  it('installs ffmpeg before starting expo-device-hub for Linux', async () => {
    const packageVersion = '1.2.3';
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://android-preview.example.test',
      close,
    } as never);
    // `env` has no PATH, so the host installs ffmpeg.
    jest
      .mocked(spawn)
      .mockReturnValueOnce(Promise.resolve({}) as unknown as ReturnType<typeof spawn>)
      .mockReturnValueOnce(Promise.resolve({}) as unknown as ReturnType<typeof spawn>);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
      packageVersion,
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    const spawnCalls = jest.mocked(spawn).mock.calls;
    expect(spawnCalls[0]).toEqual([
      'sudo',
      ['apt-get', 'update'],
      expect.objectContaining({
        env: expect.objectContaining({ DEBIAN_FRONTEND: 'noninteractive' }),
      }),
    ]);
    expect(spawnCalls[1]).toEqual([
      'sudo',
      ['apt-get', 'install', '-y', 'ffmpeg'],
      expect.objectContaining({
        env: expect.objectContaining({ DEBIAN_FRONTEND: 'noninteractive' }),
      }),
    ]);
    expect(spawnCalls[2]).toEqual(['ffmpeg', ['-version'], { env }]);
    const expoDeviceHubCallIndex = spawnCalls.findIndex(([command]) => command === 'npx');
    expect(expoDeviceHubCallIndex).toBeGreaterThan(2);
    expect(jest.mocked(spawn).mock.invocationCallOrder[1]).toBeLessThan(
      jest.mocked(spawn).mock.invocationCallOrder[expoDeviceHubCallIndex]
    );
    const [command, args] = spawnCalls[expoDeviceHubCallIndex];
    const port = Number(args[args.indexOf('--port') + 1]);
    expect(port).toBeGreaterThan(0);
    expect(command).toBe('npx');
    expect(args).toContain('--android-recording-directory');
    const recordingDirectory = args[args.indexOf('--android-recording-directory') + 1];
    expect(args).toEqual([
      '--yes',
      ...createExpoDeviceHubArgs({ port, turnArgs, packageVersion, recordingDirectory }),
    ]);
    expect(ngrok.forward).toHaveBeenCalledWith(expect.objectContaining({ addr: port }));
    expect(preview.apiUrl).toBe('https://android-preview.example.test');

    await host.finishAsync();
    await fs.rm(recordingDirectory, { recursive: true, force: true });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('carries the serve-sim session token for Darwin', async () => {
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://preview.example.test',
      close: jest.fn().mockResolvedValue(undefined),
    } as never);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    expect(preview.previewToken).toBe('tok-1');
    expect(preview.apiUrl).toBe('https://preview.example.test');
  });

  it.each([
    [{}, 'https://expo.dev'],
    [{ EXPO_STAGING: '1' }, 'https://staging.expo.dev'],
    [{ EXPO_LOCAL: '1' }, 'https://expo.test'],
  ])('points the preview page at the website for the stage the worker runs in', (stage, origin) => {
    expect(websiteOrigin({ ...env, ...stage })).toBe(origin);
    expect(simulatorPreviewPageUrl({ ...env, ...stage }, 'abc')).toBe(
      `${origin}/simulator-preview/abc`
    );
  });

  it('points the preview URL at the website page for the tunnel', async () => {
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://preview.example.test',
      close: jest.fn().mockResolvedValue(undefined),
    } as never);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: { ...env, EXPO_STAGING: '1' },
      logger: createLoggerMock(),
      timeoutMs: 10_000,
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    expect(preview.previewPageUrl).toMatch(
      /^https:\/\/staging\.expo\.dev\/simulator-preview\/[a-f0-9]{32}$/
    );
    const previewId = preview.previewPageUrl.split('/').at(-1);
    expect(ngrok.forward).toHaveBeenCalledWith(
      expect.objectContaining({ domain: `web-preview-${previewId}.${baseDomain}` })
    );
  });

  // serve-sim is always launched with --require-token, so a missing token means it is running
  // ungated on a public tunnel. Failing beats handing out a preview that is dead or unprotected.
  it('fails for Darwin when serve-sim reports no token', async () => {
    jest
      .mocked(readServeSimServersAsync)
      .mockResolvedValue([{ udid: 'device-id', url: 'http://127.0.0.1:1' }]);

    await expect(
      startDeviceSessionHostAsync(createCtxMock(), {
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env,
        logger: createLoggerMock(),
        timeoutMs: 10_000,
      })
    ).rejects.toThrow(/wrote no session token/);
  });

  // expo-device-hub mints no token, so the Android preview must not require one.
  it('starts for Linux without a token, and does not gate expo-device-hub', async () => {
    jest.mocked(readServeSimServersAsync).mockResolvedValue([]);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://android-preview.example.test',
      close: jest.fn().mockResolvedValue(undefined),
    } as never);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    expect(preview.previewToken).toBeUndefined();
    const [, args] = jest.mocked(spawn).mock.calls[0];
    expect(args).not.toContain('--require-token');
  });

  it('starts serve-sim for Darwin with its metrics policy and cleans up the preview resources', async () => {
    const packageVersion = '4.5.6';
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://ios-preview.example.test',
      close,
    } as never);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
      packageVersion,
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    const [command, args] = jest.mocked(spawn).mock.calls[0];
    const port = Number(args[args.indexOf('--port') + 1]);
    expect(port).toBeGreaterThan(0);
    expect(command).toBe('npx');
    expect(args).toEqual([
      '--yes',
      ...createServeSimArgs({
        port,
        turnArgs,
        websiteArgs,
        shareUrl: preview.previewPageUrl,
        packageVersion,
      }),
    ]);
    expect(ngrok.forward).toHaveBeenCalledWith(expect.objectContaining({ addr: port }));
    expect(preview.apiUrl).toBe('https://ios-preview.example.test');

    await host.finishAsync();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('launches serve-sim with bun x when EAS_OVERRIDE_PACKAGE_MANAGER is bun', async () => {
    const usePackage = jest.spyOn(IosSimulatorRecordingUtils, 'useServeSimPackage');
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://ios-preview.example.test',
      close,
    } as never);

    const bunEnv = { ...env, EAS_OVERRIDE_PACKAGE_MANAGER: 'bun' };
    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: bunEnv,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
      packageVersion: '4.5.6',
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    const [command, args] = jest.mocked(spawn).mock.calls[0];
    const port = Number(args[args.indexOf('--port') + 1]);
    expect(command).toBe('bun');
    expect(args).toEqual([
      'x',
      ...createServeSimArgs({
        port,
        turnArgs,
        websiteArgs,
        shareUrl: preview.previewPageUrl,
        packageVersion: '4.5.6',
      }),
    ]);
    expect(usePackage).toHaveBeenCalledWith('@expo/serve-sim@4.5.6');

    await host.finishAsync();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('launches serve-sim with bun x when EAS_FALLBACK_PACKAGE_MANAGER is bun', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://ios-preview.example.test',
      close,
    } as never);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: { ...env, EAS_FALLBACK_PACKAGE_MANAGER: 'bun' },
      logger: createLoggerMock(),
      timeoutMs: 10_000,
    });
    const preview = await host.openPreviewAsync({ baseDomain });

    const [command, args] = jest.mocked(spawn).mock.calls[0];
    const port = Number(args[args.indexOf('--port') + 1]);
    expect(command).toBe('bun');
    expect(args).toEqual([
      'x',
      ...createServeSimArgs({
        port,
        turnArgs,
        websiteArgs,
        shareUrl: preview.previewPageUrl,
      }),
    ]);

    await host.finishAsync();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('hands the launch options to serve-sim on Darwin', async () => {
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://ios-preview.example.test',
      close: jest.fn().mockResolvedValue(undefined),
    } as never);

    const host = await startDeviceSessionHostAsync(createCtxMock(), {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger: createLoggerMock(),
      timeoutMs: 10_000,
      launchAppIdentifier: 'host.exp.Exponent',
      launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
      openUrl: 'exp://127.0.0.1:8081',
    });
    await host.finishAsync();

    const [, args] = jest.mocked(spawn).mock.calls[0];
    expect(args.slice(-8)).toEqual([
      '--launch-app-identifier',
      'host.exp.Exponent',
      '--launch-arg',
      '-EXDevMenuIsOnboardingFinished',
      '--launch-arg',
      '1',
      '--open-url',
      'exp://127.0.0.1:8081',
    ]);
  });

  it('refuses to launch an application on Linux, where expo-device-hub cannot', async () => {
    await expect(
      startDeviceSessionHostAsync(createCtxMock(), {
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env,
        logger: createLoggerMock(),
        timeoutMs: 10_000,
        launchAppIdentifier: 'host.exp.Exponent',
      })
    ).rejects.toThrow('Cannot launch host.exp.Exponent');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe(turnIceServersToWebPreviewArgs, () => {
  it('returns no args for an empty ICE server list', () => {
    expect(turnIceServersToWebPreviewArgs([])).toEqual([]);
  });

  it('builds --stun-url and --turn-url flags from Cloudflare ICE servers', () => {
    expect(
      turnIceServersToWebPreviewArgs([
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'user-123',
          credential: 'cred-456',
        },
      ])
    ).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478,stun:stun.cloudflare.com:53',
      '--turn-url',
      'turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'user-123',
      '--turn-credential',
      'cred-456',
    ]);
  });

  it('emits only --turn-url flags when no credential-less (STUN) entry is present', () => {
    expect(
      turnIceServersToWebPreviewArgs([
        {
          urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
          username: 'u',
          credential: 'c',
        },
      ])
    ).toEqual([
      '--turn-url',
      'turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'u',
      '--turn-credential',
      'c',
    ]);
  });

  it('emits only --stun-url when there is no credentialed TURN entry', () => {
    expect(turnIceServersToWebPreviewArgs([{ urls: ['stun:stun.cloudflare.com:3478'] }])).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478',
    ]);
  });
});

describe(fetchWebPreviewTurnArgsAsync, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('requests TURN ICE servers from the device run session endpoint and returns web preview args', async () => {
    jest.mocked(turtleFetch).mockResolvedValue({
      json: async () => ({
        data: {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            {
              urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
              username: 'u',
              credential: 'c',
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof turtleFetch>>);

    const args = await fetchWebPreviewTurnArgsAsync(createCtxMock(), {
      env: createEnvMock(),
      logger: createLoggerMock(),
    });

    expect(args).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478',
      '--turn-url',
      'turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'u',
      '--turn-credential',
      'c',
    ]);
    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/device-run-sessions/drs-id/turn-ice-servers',
      'POST',
      expect.objectContaining({
        headers: { Authorization: 'Bearer robot-token' },
      })
    );
  });

  it('returns [] and warns when the request fails so the web preview falls back to P2P/STUN', async () => {
    jest.mocked(turtleFetch).mockRejectedValue(new Error('boom'));
    const logger = createLoggerMock();

    const args = await fetchWebPreviewTurnArgsAsync(createCtxMock(), {
      env: createEnvMock(),
      logger,
    });

    expect(args).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });
});

describe(waitForDeviceRunSessionStoppedAsync, () => {
  const durationTimeout = {} as NodeJS.Timeout;

  beforeEach(() => {
    jest.mocked(Sentry).capture.mockReset();
    jest.mocked(setTimeoutCallback).mockReset();
    jest.mocked(setTimeoutCallback).mockReturnValue(durationTimeout);
    jest.mocked(clearTimeoutCallback).mockReset();
    jest.mocked(setTimeoutAsync).mockReset();
    jest.mocked(setTimeoutAsync).mockResolvedValue(undefined);
  });

  it('continues polling until the device run session is stopped', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }, { status: 'STOPPED' }]);
    const logger = createLoggerMock();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    });

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('Device run session drs-id was stopped.');
    expect(setTimeoutCallback).not.toHaveBeenCalled();
  });

  it('returns normally when the maximum duration elapses', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }]);
    const logger = createLoggerMock();
    const waitPromise = waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
      maxDurationSeconds: 1,
    });

    expect(setTimeoutCallback).toHaveBeenCalledWith(expect.any(Function), 1_000);
    const durationTimeoutCallback = jest.mocked(setTimeoutCallback).mock.calls[0][0];
    durationTimeoutCallback();
    await waitPromise;

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Device run session drs-id reached its maximum duration.'
    );
    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('clears the duration timeout when the session stops first', async () => {
    await waitForDeviceRunSessionStoppedAsync({
      ctx: createStatusCtxMock([{ status: 'STOPPED' }]),
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      maxDurationSeconds: 30,
    });

    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('does not poll when the build step is already aborted', async () => {
    const ctx = createStatusCtxMock([]);
    const abortController = new AbortController();
    abortController.abort();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      maxDurationSeconds: 30,
      signal: abortController.signal,
    });

    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
    expect(setTimeoutCallback).not.toHaveBeenCalled();
  });

  it('throws when the device run session errors', async () => {
    const ctx = createStatusCtxMock([{ status: 'ERRORED' }]);

    await expect(
      waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger: createLoggerMock(),
        maxDurationSeconds: 30,
      })
    ).rejects.toThrow('Device run session drs-id errored.');
    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('clears the duration timeout when the build step is aborted', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }]);
    const abortController = new AbortController();
    const waitPromise = waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      maxDurationSeconds: 30,
      signal: abortController.signal,
    });

    abortController.abort();
    await waitPromise;

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('logs and retries transient polling errors', async () => {
    const ctx = createStatusCtxMock([{ error: new Error('network down') }, { status: 'STOPPED' }]);
    const logger = createLoggerMock();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    });

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failedStatusPollCount: 1 }),
      'Could not poll device run session status; will retry.'
    );
    expect(jest.mocked(Sentry).capture).toHaveBeenCalledWith(
      'Could not poll device run session status',
      expect.any(Error),
      { level: 'warning' }
    );
  });

  it('logs and retries when the status response is missing', async () => {
    const ctx = createStatusCtxMock([
      { data: { deviceRunSessions: { byId: null } } },
      { status: 'STOPPED' },
    ]);
    const logger = createLoggerMock();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    });

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failedStatusPollCount: 1 }),
      'Could not poll device run session status; will retry.'
    );
    expect(jest.mocked(Sentry).capture).toHaveBeenCalledWith(
      'Could not poll device run session status',
      expect.objectContaining({
        message: 'Device run session drs-id status response was missing.',
      }),
      { level: 'warning' }
    );
  });

  describe('with an idle timeout', () => {
    beforeEach(() => {
      // Fake timers make Date.now() advance by exactly the poll interval per
      // loop iteration, so idle time accumulates deterministically.
      jest.useFakeTimers();
      jest.mocked(setTimeoutAsync).mockImplementation(async delayMs => {
        jest.advanceTimersByTime(delayMs ?? 0);
        return undefined;
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function manyInProgressStatuses(): { status: 'IN_PROGRESS' }[] {
      return Array.from({ length: 20 }, () => ({ status: 'IN_PROGRESS' as const }));
    }

    it('stops the session when no activity is observed within the max idle time', async () => {
      const ctx = createStatusCtxMock(manyInProgressStatuses());
      const logger = createLoggerMock();

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger,
        idleTimeout: {
          maxIdleTimeMinutes: 1,
          getLastEventObservedAt: () => undefined,
        },
      });

      // One minute at the 5-second poll interval is 12 status polls.
      expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(12);
      expect(ctx.graphqlClient.mutation).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        'Device run session drs-id had no activity for 1 minute(s) (max idle time). Stopping the session.'
      );
    });

    it('keeps the session alive while events keep arriving', async () => {
      const ctx = createStatusCtxMock([...manyInProgressStatuses(), { status: 'STOPPED' }]);
      const logger = createLoggerMock();

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger,
        idleTimeout: {
          maxIdleTimeMinutes: 1,
          // Fresh activity on every check; 20 polls exceed one minute, so the
          // session would have been stopped without these events.
          getLastEventObservedAt: () => new Date(),
        },
      });

      expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(21);
      expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Device run session drs-id was stopped.');
    });

    it('still returns when the session cannot be marked stopped', async () => {
      const ctx = createStatusCtxMock(manyInProgressStatuses(), {
        ensureStoppedError: new Error('forbidden'),
      });
      const logger = createLoggerMock();

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger,
        idleTimeout: {
          maxIdleTimeMinutes: 1,
          getLastEventObservedAt: () => undefined,
        },
      });

      expect(ctx.graphqlClient.mutation).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Could not mark device run session drs-id as stopped. The session job ends anyway.'
      );
      expect(jest.mocked(Sentry).capture).toHaveBeenCalledWith(
        'Could not mark idle device run session as stopped',
        expect.any(Error),
        { level: 'warning', extras: { deviceRunSessionId: 'drs-id' } }
      );
    });
  });
});

describe(ensureFfmpegInstalledOnceAsync, () => {
  const spawnMock = jest.mocked(spawn);
  let binDirectory: string;

  function spawnResolved(): ReturnType<typeof spawn> {
    return Promise.resolve({}) as unknown as ReturnType<typeof spawn>;
  }

  function spawnRejected(): ReturnType<typeof spawn> {
    return Promise.reject(new Error('boom')) as unknown as ReturnType<typeof spawn>;
  }

  function spawnPending(): ReturnType<typeof spawn> {
    return new Promise(() => {}) as unknown as ReturnType<typeof spawn>;
  }

  async function installFakeFfmpegAsync({ mode }: { mode: number }): Promise<string> {
    const ffmpegPath = path.join(binDirectory, 'ffmpeg');
    await fs.writeFile(ffmpegPath, '#!/bin/sh\n');
    await fs.chmod(ffmpegPath, mode);
    return ffmpegPath;
  }

  function createPathEnv(): BuildStepEnv {
    return { ...createEnvMock(), PATH: binDirectory };
  }

  const warmUpCall = ['ffmpeg', ['-version'], expect.anything()];

  beforeEach(async () => {
    spawnMock.mockReset();
    jest.mocked(Sentry).capture.mockReset();
    binDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-path-'));
  });

  afterEach(async () => {
    await fs.rm(binDirectory, { recursive: true, force: true });
  });

  it('finds ffmpeg on PATH without waiting for it to run, then warms it up', async () => {
    const ffmpegPath = await installFakeFfmpegAsync({ mode: 0o755 });
    spawnMock.mockReturnValueOnce(spawnPending());
    const logger = createLoggerMock();

    await ensureFfmpegInstalledOnceAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: createPathEnv(),
      logger,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(...warmUpCall);
    expect(logger.info).toHaveBeenCalledWith(`ffmpeg is already installed at ${ffmpegPath}.`);
  });

  it('installs ffmpeg when the file on PATH is not executable', async () => {
    await installFakeFfmpegAsync({ mode: 0o644 });
    spawnMock.mockReturnValue(spawnResolved());

    await ensureFfmpegInstalledOnceAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: createPathEnv(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenCalledWith('brew', ['install', 'ffmpeg'], expect.anything());
  });

  it('installs ffmpeg when the ffmpeg entry on PATH is a directory', async () => {
    await fs.mkdir(path.join(binDirectory, 'ffmpeg'));
    spawnMock.mockReturnValue(spawnResolved());

    await ensureFfmpegInstalledOnceAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: createPathEnv(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenCalledWith('brew', ['install', 'ffmpeg'], expect.anything());
  });

  it('treats an empty PATH entry as the current directory', async () => {
    await installFakeFfmpegAsync({ mode: 0o755 });
    jest.spyOn(process, 'cwd').mockReturnValue(binDirectory);
    spawnMock.mockReturnValue(spawnResolved());

    try {
      await ensureFfmpegInstalledOnceAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: { ...createEnvMock(), PATH: `${path.delimiter}/nonexistent` },
        logger: createLoggerMock(),
      });
    } finally {
      jest.mocked(process.cwd).mockRestore();
    }

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(...warmUpCall);
  });

  it('installs ffmpeg with Homebrew on darwin when it is missing, then warms it up', async () => {
    spawnMock.mockReturnValue(spawnResolved());

    await ensureFfmpegInstalledOnceAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: createPathEnv(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'brew',
      ['install', 'ffmpeg'],
      expect.objectContaining({
        env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }),
      })
    );
    expect(spawnMock).toHaveBeenLastCalledWith(...warmUpCall);
  });

  it('installs ffmpeg with apt on linux when it is missing', async () => {
    spawnMock.mockReturnValue(spawnResolved());

    await ensureFfmpegInstalledOnceAsync({
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: createPathEnv(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'sudo',
      ['apt-get', 'update'],
      expect.objectContaining({
        env: expect.objectContaining({ DEBIAN_FRONTEND: 'noninteractive' }),
      })
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'sudo',
      ['apt-get', 'install', '-y', 'ffmpeg'],
      expect.objectContaining({
        env: expect.objectContaining({ DEBIAN_FRONTEND: 'noninteractive' }),
      })
    );
    expect(spawnMock).toHaveBeenLastCalledWith(...warmUpCall);
  });

  it('shares an in-flight ffmpeg setup between callers', async () => {
    let finishInstall: (() => void) | undefined;
    const pendingInstall = new Promise<void>(resolve => {
      finishInstall = resolve;
    });
    spawnMock
      .mockReturnValueOnce(spawnResolved()) // apt-get update
      .mockReturnValueOnce(pendingInstall as unknown as ReturnType<typeof spawn>) // apt-get install
      .mockReturnValueOnce(spawnResolved()); // ffmpeg -version warm-up
    const options = {
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: createPathEnv(),
      logger: createLoggerMock(),
    };

    const firstSetup = ensureFfmpegInstalledOnceAsync(options);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(spawnMock).toHaveBeenCalledTimes(2);

    const secondSetup = ensureFfmpegInstalledOnceAsync(options);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    finishInstall?.();
    await Promise.all([firstSetup, secondSetup]);
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it('still installs on linux when the apt index refresh fails', async () => {
    spawnMock
      .mockReturnValueOnce(spawnRejected()) // apt-get update
      .mockReturnValue(spawnResolved());
    const logger = createLoggerMock();

    await ensureFfmpegInstalledOnceAsync({
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: createPathEnv(),
      logger,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'sudo',
      ['apt-get', 'install', '-y', 'ffmpeg'],
      expect.anything()
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns and resolves when the install fails, so the session still starts', async () => {
    spawnMock.mockReturnValueOnce(spawnRejected());
    const logger = createLoggerMock();

    await expect(
      ensureFfmpegInstalledOnceAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: createPathEnv(),
        logger,
      })
    ).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });

  // The caller runs this with `void` and the worker installs no unhandledRejection
  // handler, so a rejection here would crash the process. `spawn` is not async and
  // can throw synchronously, which `asyncResult` cannot catch.
  it('resolves when the install throws synchronously', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('sync spawn failure');
    });
    const logger = createLoggerMock();

    await expect(
      ensureFfmpegInstalledOnceAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: createPathEnv(),
        logger,
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });

  it.each([
    ['rejects', () => spawnRejected()],
    [
      'throws synchronously',
      () => {
        throw new Error('sync spawn failure');
      },
    ],
  ])('ignores a warm-up that %s', async (_, warmUp) => {
    await installFakeFfmpegAsync({ mode: 0o755 });
    spawnMock.mockImplementationOnce(warmUp as () => ReturnType<typeof spawn>);
    const logger = createLoggerMock();

    await expect(
      ensureFfmpegInstalledOnceAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: createPathEnv(),
        logger,
      })
    ).resolves.toBeUndefined();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
