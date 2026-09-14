import { type bunyan } from '@expo/logger';
import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CHISEL_VERSION,
  LOCAL_EGRESS_HANDOFF_PATH,
  LOCAL_EGRESS_PROXY_PORT,
  configureSystemProxyAsync,
  createChiselAuthfileContents,
  downloadChiselAsync,
  generateEgressCredentials,
  registerLocalEgressResources,
  startChiselServerAsync,
  stopLocalEgressResourcesAsync,
  writeLocalEgressHandoffAsync,
} from '../utils/localEgress';
import {
  type DetachedProcessHandle,
  type NgrokTunnelHandle,
  findAvailablePortAsync,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  startNgrokTunnelAsync,
} from '../utils/remoteDeviceRunSession';

/**
 * The downloader and ngrok SDK do not accept an AbortSignal. Stop awaiting them
 * on cancellation, while retaining handlers that dispose any eventual result.
 */
function awaitLocalEgressAcquisitionAsync<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  disposeAbandonedAsync: (result?: T) => Promise<void>,
  logger: bunyan
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let abandoned = false;
    const abort = (): void => {
      signal.removeEventListener('abort', abort);
      abandoned = true;
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
    }
    void pending
      .then(
        async result => {
          signal.removeEventListener('abort', abort);
          if (abandoned) {
            await disposeAbandonedAsync(result);
          } else {
            resolve(result);
          }
        },
        async error => {
          signal.removeEventListener('abort', abort);
          if (abandoned) {
            await disposeAbandonedAsync();
          } else {
            reject(error);
          }
        }
      )
      .catch(err =>
        logger.warn({ err }, 'Could not release a cancelled local egress acquisition.')
      );
  });
}

/**
 * Points the device host's system HTTP(S) proxy at the EAS CLI's egress client.
 * Must run before `eas/start_ios_simulator`: the simulator reads the system proxy
 * at boot. Once a simulator is ready, `eas/start_ios_simulator` also sets proxy
 * environment variables inside it for clients that read them (gRPC, libcurl).
 * Libraries that ignore both are not covered; the shared session monitor
 * reports them. The shared session cleanup releases the resources started here when
 * the session ends, with a job finalizer as a fallback.
 */
export function createStartLocalEgressBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_local_egress',
    name: 'Start local egress',
    __metricsId: 'eas/start_local_egress',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env, signal }) => {
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);
      let workDir: string | undefined;
      let server: DetachedProcessHandle | undefined;
      let tunnel: NgrokTunnelHandle | undefined;
      let finishSetup!: () => void;
      const setupFinished = new Promise<void>(resolve => {
        finishSetup = resolve;
      });
      // Register before acquisition. Cancellation ends setup promptly; pending
      // SDK calls retain their own late-result disposal handlers.
      const lifetimeSignal = registerLocalEgressResources(async () => {
        await setupFinished;
        const results = await Promise.allSettled([
          Promise.resolve().then(() => tunnel?.stopAsync()),
          Promise.resolve().then(() => server?.stopAsync()),
        ]);
        for (const result of results) {
          if (result.status === 'rejected') {
            logger.warn({ err: result.reason }, 'Could not stop a local egress resource.');
          }
        }
        await Promise.all([
          fs.promises.rm(LOCAL_EGRESS_HANDOFF_PATH, { force: true }),
          workDir ? fs.promises.rm(workDir, { recursive: true, force: true }) : undefined,
        ]);
      });
      const startupSignal = signal ? AbortSignal.any([signal, lifetimeSignal]) : lifetimeSignal;

      try {
        startupSignal.throwIfAborted();
        workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-local-egress-'));
        startupSignal.throwIfAborted();
        logger.info(`Downloading the reverse tunnel server (chisel ${CHISEL_VERSION}).`);
        const downloadDir = workDir;
        const chiselPath = await awaitLocalEgressAcquisitionAsync(
          downloadChiselAsync({ destinationDir: downloadDir, logger }),
          startupSignal,
          async () => await fs.promises.rm(downloadDir, { recursive: true, force: true }),
          logger
        );
        startupSignal.throwIfAborted();

        const credentials = generateEgressCredentials();
        const authfilePath = path.join(workDir, 'authfile.json');
        await fs.promises.writeFile(
          authfilePath,
          createChiselAuthfileContents({ ...credentials, port: LOCAL_EGRESS_PROXY_PORT }),
          { encoding: 'utf8', mode: 0o600 }
        );
        startupSignal.throwIfAborted();

        const controlPort = await findAvailablePortAsync();
        startupSignal.throwIfAborted();
        logger.info(`Starting the reverse tunnel server on 127.0.0.1:${controlPort}.`);
        const started = await startChiselServerAsync({
          chiselPath,
          controlPort,
          authfilePath,
          env,
          signal: startupSignal,
        });
        server = started.process;
        startupSignal.throwIfAborted();
        tunnel = await awaitLocalEgressAcquisitionAsync(
          startNgrokTunnelAsync({
            port: controlPort,
            subdomainPrefix: 'egress',
            baseDomain: ngrokTunnelDomain,
            authtoken: ngrokAuthtoken,
            logger,
          }),
          startupSignal,
          async listener => await listener?.stopAsync(),
          logger
        );
        startupSignal.throwIfAborted();

        const { service } = await configureSystemProxyAsync({
          env,
          logger,
          port: LOCAL_EGRESS_PROXY_PORT,
          signal: startupSignal,
        });
        startupSignal.throwIfAborted();
        await writeLocalEgressHandoffAsync({
          url: tunnel.url,
          token: credentials.password,
          fingerprint: started.fingerprint,
          port: LOCAL_EGRESS_PROXY_PORT,
        });
        startupSignal.throwIfAborted();
        logger.info(
          `Local egress is configured on network service "${service}". HTTP(S) and WebSocket ` +
            'requests that honor the system proxy (WebKit, URLSession and other CFNetwork clients) ' +
            'fail until the EAS CLI egress client connects, then exit from that machine. Once the ' +
            'Simulator is ready, proxy environment variables are set inside it for clients that read ' +
            'them (gRPC, libcurl). Requests from libraries that ignore both are not covered and exit ' +
            'from this worker. ' +
            'Connection sampling may report these bypasses, but can miss short connections and unconnected UDP traffic.'
        );
      } catch (error) {
        finishSetup();
        await stopLocalEgressResourcesAsync(logger);
        throw error;
      } finally {
        finishSetup();
      }
    },
  });
}
