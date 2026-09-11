import { type bunyan } from '@expo/logger';
import { type BuildStepContext } from '@expo/steps';
import fs from 'node:fs';

import {
  LOCAL_EGRESS_HANDOFF_PATH,
  configureSystemProxyAsync,
  downloadChiselAsync,
  startChiselServerAsync,
  stopLocalEgressResourcesAsync,
  writeLocalEgressHandoffAsync,
} from '../../utils/localEgress';
import { findAvailablePortAsync, startNgrokTunnelAsync } from '../../utils/remoteDeviceRunSession';
import { createStartLocalEgressBuildFunction } from '../startLocalEgress';

jest.mock('../../utils/localEgress', () => ({
  ...jest.requireActual('../../utils/localEgress'),
  configureSystemProxyAsync: jest.fn(),
  downloadChiselAsync: jest.fn(),
  startChiselServerAsync: jest.fn(),
  writeLocalEgressHandoffAsync: jest.fn(),
}));
jest.mock('../../utils/localEgressGuard', () => ({
  stopLocalEgressGuardRelaysAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  findAvailablePortAsync: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  getNgrokAuthtokenOrThrow: () => 'ngrok-token',
  getNgrokTunnelDomainOrThrow: () => 'example.com',
}));

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const server = { pid: 12345, getOutput: () => '', stopAsync: jest.fn() };
const tunnel = { url: 'https://egress.example.com', stopAsync: jest.fn() };

async function start(signal?: AbortSignal): Promise<void> {
  await createStartLocalEgressBuildFunction().fn!({ logger } as BuildStepContext, {
    env: {},
    inputs: {},
    outputs: {},
    signal,
  });
}

describe('local egress acquisition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/egress-acquisition-test');
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    server.stopAsync.mockResolvedValue(undefined);
    tunnel.stopAsync.mockResolvedValue(undefined);
    jest.mocked(findAvailablePortAsync).mockResolvedValue(52001);
    jest.mocked(downloadChiselAsync).mockResolvedValue('/tmp/egress-acquisition-test/chisel');
    jest.mocked(startChiselServerAsync).mockResolvedValue({ process: server, fingerprint: 'key=' });
    jest.mocked(startNgrokTunnelAsync).mockResolvedValue(tunnel);
    jest.mocked(configureSystemProxyAsync).mockResolvedValue({ service: 'Ethernet' });
    jest.mocked(writeLocalEgressHandoffAsync).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopLocalEgressResourcesAsync(logger);
    jest.restoreAllMocks();
  });

  it('stops the detached server and removes credentials when ngrok acquisition fails', async () => {
    jest.mocked(startNgrokTunnelAsync).mockRejectedValue(new Error('listener quota'));
    await expect(start()).rejects.toThrow('listener quota');
    expect(server.stopAsync).toHaveBeenCalledTimes(1);
    expect(configureSystemProxyAsync).not.toHaveBeenCalled();
    expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/egress-acquisition-test', {
      recursive: true,
      force: true,
    });
  });

  it('attempts every release even when one resource cannot stop', async () => {
    await start();
    tunnel.stopAsync.mockRejectedValue(new Error('ngrok close failed'));
    await stopLocalEgressResourcesAsync(logger);
    expect(server.stopAsync).toHaveBeenCalledTimes(1);
    expect(fs.promises.rm).toHaveBeenCalledWith(LOCAL_EGRESS_HANDOFF_PATH, { force: true });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Could not stop a local egress resource.'
    );
  });

  it.each([false, true])(
    'disposes late listeners without delaying cleanup (close fails: %s)',
    async closeFails => {
      let finishTunnel!: (value: typeof tunnel) => void;
      jest.mocked(startNgrokTunnelAsync).mockImplementation(
        () =>
          new Promise(resolve => {
            finishTunnel = resolve;
          })
      );
      const started = start();
      const rejected = expect(started).rejects.toThrow();
      await new Promise(resolve => setImmediate(resolve));
      expect(startNgrokTunnelAsync).toHaveBeenCalledTimes(1);
      const stopped = stopLocalEgressResourcesAsync(logger);
      await Promise.all([stopped, rejected]);
      expect(server.stopAsync).toHaveBeenCalledTimes(1);
      expect(tunnel.stopAsync).not.toHaveBeenCalled();
      if (closeFails) {
        tunnel.stopAsync.mockRejectedValue(new Error('late close failed'));
      }
      finishTunnel(tunnel);
      await new Promise(resolve => setImmediate(resolve));
      if (closeFails) {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Could not release a cancelled local egress acquisition.'
        );
      }
      expect(tunnel.stopAsync).toHaveBeenCalledTimes(1);
      expect(configureSystemProxyAsync).not.toHaveBeenCalled();
      expect(writeLocalEgressHandoffAsync).not.toHaveBeenCalled();
    }
  );

  it.each(['job', 'step'])('finishes %s cancellation when ngrok never settles', async source => {
    jest.mocked(startNgrokTunnelAsync).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const started = start(controller.signal);
    const rejected = expect(started).rejects.toThrow();
    await new Promise(resolve => setImmediate(resolve));
    expect(startNgrokTunnelAsync).toHaveBeenCalledTimes(1);
    if (source === 'step') {
      controller.abort(new Error('cancelled'));
    }
    const stopped = source === 'job' ? stopLocalEgressResourcesAsync(logger) : Promise.resolve();
    const outcome = await Promise.race([
      Promise.all([stopped, rejected]).then(() => 'stopped'),
      new Promise(resolve => setImmediate(() => resolve('still waiting'))),
    ]);
    expect(outcome).toBe('stopped');
    expect(server.stopAsync).toHaveBeenCalledTimes(1);
    expect(configureSystemProxyAsync).not.toHaveBeenCalled();
    expect(writeLocalEgressHandoffAsync).not.toHaveBeenCalled();
  });

  it('handles ngrok rejection after finalization without an unhandled rejection', async () => {
    let rejectTunnel!: (error: Error) => void;
    jest.mocked(startNgrokTunnelAsync).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectTunnel = reject;
      })
    );
    const started = start();
    const rejected = expect(started).rejects.toThrow();
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all([stopLocalEgressResourcesAsync(logger), rejected]);
    rejectTunnel(new Error('late connection failure'));
    await new Promise(resolve => setImmediate(resolve));
    expect(server.stopAsync).toHaveBeenCalledTimes(1);
    expect(configureSystemProxyAsync).not.toHaveBeenCalled();
  });

  it('does not launch a server after a download finishes following cancellation', async () => {
    let finishDownload!: (value: string) => void;
    jest.mocked(downloadChiselAsync).mockImplementation(
      () =>
        new Promise(resolve => {
          finishDownload = resolve;
        })
    );
    const controller = new AbortController();
    const started = start(controller.signal);
    const rejected = expect(started).rejects.toThrow('cancelled');
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(new Error('cancelled'));
    await rejected;
    finishDownload('/tmp/chisel');
    await new Promise(resolve => setImmediate(resolve));
    expect(startChiselServerAsync).not.toHaveBeenCalled();
    expect(
      jest
        .mocked(fs.promises.rm)
        .mock.calls.filter(([target]) => target === '/tmp/egress-acquisition-test')
    ).toHaveLength(2);
    expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/egress-acquisition-test', {
      recursive: true,
      force: true,
    });
  });
});
