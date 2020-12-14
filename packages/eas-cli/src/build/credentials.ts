import { Platform, Workflow } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';
import ora from 'ora';

import { CredentialsProvider } from '../credentials/CredentialsProvider';
import log from '../log';
import { confirmAsync, promptAsync } from '../prompts';
import { platformDisplayNames } from './constants';

function logCredentials(target: 'local' | 'remote', platform: Platform) {
  let message = `Using ${target} ${platformDisplayNames[platform]} credentials`;
  if (target === 'local') message += ` ${chalk.dim('(credentials.json)')}`;
  if (target === 'remote') message += ` ${chalk.dim('(Expo server)')}`;
  ora(message).succeed();
}

async function ensureCredentialsAutoAsync(
  provider: CredentialsProvider,
  workflow: Workflow,
  nonInteractive: boolean
): Promise<CredentialsSource.LOCAL | CredentialsSource.REMOTE> {
  const platform = platformDisplayNames[provider.platform];
  switch (workflow) {
    case Workflow.Managed:
      if (await provider.hasLocalAsync()) {
        return CredentialsSource.LOCAL;
      } else {
        return CredentialsSource.REMOTE;
      }
    case Workflow.Generic: {
      const hasLocal = await provider.hasLocalAsync();
      const hasRemote = await provider.hasRemoteAsync();
      if (hasRemote && hasLocal) {
        if (!(await provider.isLocalSyncedAsync())) {
          if (nonInteractive) {
            throw new Error(
              `Contents of your local credentials.json for ${platform} are not the same as credentials on Expo servers. To use the desired credentials, set the "builds.${platform}.{profile}.credentialsSource" field in the credentials.json file to one of the following: "local", "remote".`
            );
          } else {
            log(
              `Contents of your local credentials.json for ${platform} are not the same as credentials on Expo servers`
            );
          }

          const { select } = await promptAsync({
            type: 'select',
            name: 'select',
            message: 'Which credentials do you want to use for this build?',
            choices: [
              { title: 'Local credentials.json', value: CredentialsSource.LOCAL },
              { title: 'Credentials stored on Expo servers.', value: CredentialsSource.REMOTE },
            ],
          });
          return select;
        } else {
          return CredentialsSource.LOCAL;
        }
      } else if (hasLocal) {
        logCredentials('local', provider.platform);
        return CredentialsSource.LOCAL;
      } else if (hasRemote) {
        logCredentials('remote', provider.platform);
        return CredentialsSource.REMOTE;
      } else {
        if (nonInteractive) {
          throw new Error(
            `Credentials for this app are not configured and there is no entry in credentials.json for ${platform}. Either configure credentials.json, or launch the build without "--non-interactive" flag to get a prompt to generate credentials automatically.`
          );
        } else {
          if (log.isDebug) {
            log.warn(
              `Credentials for this app are not configured and there is no entry in credentials.json for ${platform}`
            );
          }
        }

        const confirm = await confirmAsync({
          message: `${platform} credentials not found, generate now?`,
        });
        if (confirm) {
          return CredentialsSource.REMOTE;
        } else {
          throw new Error(`Aborting build process, credentials are not configured for ${platform}`);
        }
      }
    }
  }
}

export async function ensureCredentialsAsync(
  provider: CredentialsProvider,
  workflow: Workflow,
  src: CredentialsSource,
  nonInteractive: boolean
): Promise<CredentialsSource.LOCAL | CredentialsSource.REMOTE> {
  switch (src) {
    case CredentialsSource.LOCAL:
      logCredentials('local', provider.platform);
      return CredentialsSource.LOCAL;
    case CredentialsSource.REMOTE:
      logCredentials('remote', provider.platform);
      return CredentialsSource.REMOTE;
    case CredentialsSource.AUTO:
      return await ensureCredentialsAutoAsync(provider, workflow, nonInteractive);
  }
}
