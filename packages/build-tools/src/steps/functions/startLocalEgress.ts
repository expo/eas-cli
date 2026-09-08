import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CHISEL_VERSION,
  LOCAL_EGRESS_PROXY_PORT,
  applyEgressPfRulesAsync,
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
 * Prepares the device host so the simulator's traffic exits through the EAS
 * CLI's egress client. Must run before `eas/start_ios_simulator`: the simulator
 * reads the system proxy at boot. The resources it starts are released by the
 * agent-device session step when the session ends.
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
        await applyEgressPfRulesAsync({ env, logger, workDir });
        await writeLocalEgressHandoffAsync({
          url: tunnel.url,
          auth: `${credentials.user}:${credentials.password}`,
          fingerprint,
          port: LOCAL_EGRESS_PROXY_PORT,
        });
        logger.info(
          `Local egress is configured on network service "${service}". The simulator has no ` +
            'internet access until the EAS CLI egress client connects; from then on its traffic ' +
            "exits from that client's network."
        );
      } catch (error) {
        await stopLocalEgressResourcesAsync(logger);
        throw error;
      }
    },
  });
}
