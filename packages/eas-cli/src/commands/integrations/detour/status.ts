import chalk from 'chalk';
import figures from 'figures';
import * as fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { loadProjectScopedEnvVarsAsync } from '../../../environments/variables';
import {
  EAS_DETOUR_API_KEY_ENV_VAR_NAME,
  EAS_DETOUR_APP_ID_ENV_VAR_NAME,
} from '../../../integrations/detour/env';
import { resolveAndroidFingerprintsAsync } from '../../../integrations/detour/credentials';
import { readConnection } from '../../../integrations/detour/linking';
import { fetchLinkVerificationAsync } from '../../../integrations/detour/verification';
import Log from '../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

const YES = chalk.green(figures.tick);
const NO = chalk.red(figures.cross);

export default class IntegrationsDetourStatus extends EasCommand {
  static override description = "show how this project's Detour connection is set up";

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsDetourStatus);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, projectDir, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsDetourStatus, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const connection = readConnection(exp);
    if (!connection) {
      if (jsonFlag) {
        printJsonOnlyOutput({ connected: false });
        return;
      }
      Log.log('This project is not connected to Detour. Run eas integrations:detour:connect.');
      return;
    }

    // A domain changed in Detour since the write shows up here as a mismatch.
    const declaredDomains = exp.ios?.associatedDomains ?? [];
    const declaredFilters = exp.android?.intentFilters ?? [];
    const hostInIos =
      !!connection.linkHost && declaredDomains.includes(`applinks:${connection.linkHost}`);
    const hostInAndroid =
      !!connection.linkHost &&
      declaredFilters.some(filter =>
        (Array.isArray(filter.data) ? filter.data : filter.data ? [filter.data] : []).some(
          data => data?.host === connection.linkHost
        )
      );

    const envLocal = await readEnvLocalKeysAsync(projectDir);
    const easEnvironments = await Promise.all(
      [EAS_DETOUR_APP_ID_ENV_VAR_NAME, EAS_DETOUR_API_KEY_ENV_VAR_NAME].map(async name => ({
        name,
        environments: (await loadProjectScopedEnvVarsAsync(graphqlClient, projectId, name)).flatMap(
          variable => variable.environments ?? []
        ),
      }))
    );

    // Public, so no Detour authorization — and the only proof it really verifies.
    const verification = connection.linkHost
      ? await fetchLinkVerificationAsync(connection.linkHost)
      : null;

    if (jsonFlag) {
      printJsonOnlyOutput({
        connected: true,
        appId: connection.appId,
        linkHost: connection.linkHost ?? null,
        appConfig: { ios: hostInIos, android: hostInAndroid },
        envLocal,
        easEnvironments,
        verification,
      });
      return;
    }

    Log.log(`${chalk.bold('App')}         ${exp.name} (${connection.appId})`);
    Log.log(
      `${chalk.bold('Link host')}   ${connection.linkHost ?? chalk.red('not recorded')}` +
        (connection.linkHost ? `  ios ${mark(hostInIos)}  android ${mark(hostInAndroid)}` : '')
    );
    Log.log(
      `${chalk.bold('.env.local')}  ${EAS_DETOUR_APP_ID_ENV_VAR_NAME} ${mark(
        envLocal.appId
      )}  ${EAS_DETOUR_API_KEY_ENV_VAR_NAME} ${mark(envLocal.apiKey)}`
    );
    for (const { name, environments } of easEnvironments) {
      Log.log(
        `${chalk.bold('EAS env')}     ${name} ${
          environments.length > 0 ? environments.join(', ') : chalk.red('nowhere')
        }`
      );
    }

    if (!verification) {
      Log.newLine();
      Log.warn('No link host recorded, so the verification files could not be checked.');
      return;
    }

    Log.log(
      `${chalk.bold('assetlinks')}  ${mark(verification.assetlinks.served)}` +
        (verification.assetlinks.served
          ? `  ${verification.assetlinks.packageName ?? '?'}, ${
              verification.assetlinks.fingerprints.length
            } fingerprint(s)`
          : '')
    );
    Log.log(
      `${chalk.bold('AASA')}        ${mark(verification.aasa.served)}` +
        (verification.aasa.served ? `  ${verification.aasa.appIds.join(', ')}` : '')
    );

    // Everything published is a key EAS holds, so Play's own key is missing.
    if (exp.android?.package && verification.assetlinks.fingerprints.length > 0) {
      const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
      const fromEas = new Set(
        ((await resolveAndroidFingerprintsAsync(graphqlClient, exp, account.name)) ?? []).map(
          bareHex
        )
      );
      const published = verification.assetlinks.fingerprints.map(bareHex);
      if (fromEas.size > 0 && published.every(fingerprint => fromEas.has(fingerprint))) {
        Log.newLine();
        Log.warn(
          'Only your EAS keystores are published. If this app ships through Google Play, add the Play App Signing certificate too — re-run connect with --play-signing-cert.'
        );
      }
    }

    if (!verification.assetlinks.served || !verification.aasa.served) {
      Log.newLine();
      Log.warn(
        'A missing file means the OS has nothing to verify against, and links will open the browser. Re-run eas integrations:detour:connect.'
      );
    }
  }
}

function bareHex(fingerprint: string): string {
  return fingerprint.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

function mark(value: boolean): string {
  return value ? YES : NO;
}

async function readEnvLocalKeysAsync(
  projectDir: string
): Promise<{ appId: boolean; apiKey: boolean }> {
  try {
    const content = await fs.readFile(path.join(projectDir, '.env.local'), 'utf8');
    return {
      appId: content.includes(`${EAS_DETOUR_APP_ID_ENV_VAR_NAME}=`),
      apiKey: content.includes(`${EAS_DETOUR_API_KEY_ENV_VAR_NAME}=`),
    };
  } catch {
    return { appId: false, apiKey: false };
  }
}
