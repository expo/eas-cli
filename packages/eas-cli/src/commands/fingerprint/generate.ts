import { Flags } from '@oclif/core';

import {
  getFingerprintInfoFromLocalProjectForPlatformsAsync,
  stringToAppPlatform,
} from './compare';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { enableJsonOutput } from '../../utils/json';

export default class FingerprintGenerate extends EasCommand {
  static override description = 'generate fingerprints from the current project';
  static override strict = false;
  static override hidden = true;

  static override examples = ['$ eas fingerprint:compare TODO'];

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(FingerprintGenerate);
    const { json, 'non-interactive': nonInteractive, platform: platformStringFlag } = flags;

    const {
      projectId,
      privateProjectConfig: { projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(FingerprintGenerate, {
      nonInteractive,
      withServerSideEnvironment: null,
    });
    if (json) {
      enableJsonOutput();
    }

    const platform = platformStringFlag
      ? stringToAppPlatform(platformStringFlag)
      : await selectRequestedPlatformAsync();
    const fingerprint = await getFingerprintInfoFromLocalProjectForPlatformsAsync(
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      [platform]
    );

    Log.log(`Fingerprint generated: ${fingerprint.hash}`);
  }
}

export async function selectRequestedPlatformAsync(): Promise<AppPlatform> {
  const { requestedPlatform } = await promptAsync({
    type: 'select',
    message: 'Select platform',
    name: 'requestedPlatform',
    choices: [
      { title: 'Android', value: AppPlatform.Android },
      { title: 'iOS', value: AppPlatform.Ios },
    ],
  });
  return requestedPlatform;
}
