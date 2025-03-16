import { Flags } from '@oclif/core';

import {
  getFingerprintInfoFromLocalProjectForPlatformsAsync,
  stringToAppPlatform,
} from './compare';
import { getExpoWebsiteBaseUrl } from '../../api';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { link } from '../../log';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class FingerprintGenerate extends EasCommand {
  static override description = 'generate fingerprints from the current project';
  static override strict = false;
  static override hidden = true;

  static override examples = [
    '$ eas fingerprint:generate',
    '$ eas fingerprint:generate --json --non-interactive -p android',
  ];

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

    let platform: AppPlatform;
    if (platformStringFlag) {
      platform = stringToAppPlatform(platformStringFlag);
    } else {
      if (nonInteractive) {
        throw new Error('Platform must be specified in non-interactive mode with the --p flag');
      }
      platform = await selectRequestedPlatformAsync();
    }
    const fingerprint = await getFingerprintInfoFromLocalProjectForPlatformsAsync(
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      [platform]
    );

    if (json) {
      printJsonOnlyOutput(fingerprint);
      return;
    }

    Log.log(`✅ Fingerprint generated: ${fingerprint.hash}`);

    const project = await AppQuery.byIdAsync(graphqlClient, projectId);
    const fingerprintUrl = new URL(
      `/accounts/${project.ownerAccount.name}/projects/${project.slug}/fingerprints/${fingerprint.hash}`,
      getExpoWebsiteBaseUrl()
    );
    Log.log(`🔍 View the fingerprint at ${link(fingerprintUrl.toString())}`);
    Log.log(`💡 If you want to see the entire fingerprint output, pass in the --json flag.`);
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
