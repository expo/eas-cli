import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CHISEL_VERSION,
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
  findAvailablePortAsync,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  startNgrokTunnelAsync,
} from '../utils/remoteDeviceRunSession';

/**
 * Points the device host's system HTTP(S) proxy at the EAS CLI's egress client.
 * Must run before `eas/start_ios_simulator`: the simulator reads the system proxy
 * at boot. Nothing else on the host changes, so requests from libraries that
 * bypass the system proxy are not covered; the agent-device session step reports
 * them. The resources started here are released by that step when the session
 * ends.
 */
export function createStartLocalEgressBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_local_egress',
    name: 'Start local egress',
    __metricsId: 'eas/start_local_egress',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);

      const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-local-egress-'));
      logger.info(`Downloading the reverse tunnel server (chisel ${CHISEL_VERSION}).`);
      const chiselPath = await downloadChiselAsync({ destinationDir: workDir, logger });

      const credentials = generateEgressCredentials();
      const authfilePath = path.join(workDir, 'authfile.json');
      await fs.promises.writeFile(
        authfilePath,
        createChiselAuthfileContents({ ...credentials, port: LOCAL_EGRESS_PROXY_PORT }),
        { encoding: 'utf8', mode: 0o600 }
      );

      const controlPort = await findAvailablePortAsync();
      logger.info(`Starting the reverse tunnel server on 127.0.0.1:${controlPort}.`);
      const { process: server, fingerprint } = await startChiselServerAsync({
        chiselPath,
        controlPort,
        authfilePath,
        env,
      });
      const tunnel = await startNgrokTunnelAsync({
        port: controlPort,
        subdomainPrefix: 'egress',
        baseDomain: ngrokTunnelDomain,
        authtoken: ngrokAuthtoken,
        logger,
      });
      registerLocalEgressResources({ server, tunnel });

      try {
        const { service } = await configureSystemProxyAsync({
          env,
          logger,
          port: LOCAL_EGRESS_PROXY_PORT,
        });
        await writeLocalEgressHandoffAsync({
          url: tunnel.url,
          token: credentials.password,
          fingerprint,
          port: LOCAL_EGRESS_PROXY_PORT,
        });
        logger.info(
          `Local egress is configured on network service "${service}". HTTP(S) and WebSocket ` +
            'requests that honor the system proxy (WebKit, URLSession and other CFNetwork clients) ' +
            'fail until the EAS CLI egress client connects, then exit from that machine. Requests ' +
            'from libraries that bypass the system proxy are not covered and exit from this worker.'
        );
      } catch (error) {
        await stopLocalEgressResourcesAsync(logger);
        throw error;
      }
    },
  });
}
