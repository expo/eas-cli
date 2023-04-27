import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import { selectRequestedPlatformAsync, toPlatforms } from '../../../platform';
import { getApplicationIdentifierAsync } from '../../../project/applicationIdentifier';
import {
  ensureVersionSourceIsRemoteAsync,
  validateAppConfigForRemoteVersionSource,
} from '../../../project/remoteVersionSource';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import { getProfilesAsync } from '../../../utils/profiles';

export default class BuildVersionGetView extends EasCommand {
  public static override description = 'Return version stored on EAS servers';

  public static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
  };

  public async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildVersionGetView);
    if (flags.json) {
      enableJsonOutput();
    }
    const {
      loggedIn: { graphqlClient },
      getDynamicProjectConfigAsync,
      projectDir,
    } = await this.getContextAsync(BuildVersionGetView, {
      nonInteractive: true,
    });

    if (!flags.platform && flags['non-interactive']) {
      throw new Error('"--platform" param is required in a non-interactive mode.');
    }
    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);
    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    await ensureVersionSourceIsRemoteAsync(easJsonAccessor, flags['non-interactive']);

    const platforms = toPlatforms(requestedPlatform);
    const buildProfiles = await getProfilesAsync({
      type: 'build',
      easJsonAccessor,
      platforms,
      profileName: flags.profile ?? undefined,
    });
    const results: { [key in Platform]?: string } = {};
    for (const profileInfo of buildProfiles) {
      const { exp, projectId } = await getDynamicProjectConfigAsync({
        env: profileInfo.profile.env,
      });

      validateAppConfigForRemoteVersionSource(exp, profileInfo.platform);

      const applicationIdentifier = await getApplicationIdentifierAsync({
        graphqlClient,
        projectDir,
        projectId,
        exp,
        buildProfile: profileInfo.profile,
        platform: profileInfo.platform,
      });
      const remoteVersions = await AppVersionQuery.latestVersionAsync(
        graphqlClient,
        projectId,
        toAppPlatform(profileInfo.platform),
        applicationIdentifier
      );
      if (remoteVersions?.buildVersion) {
        results[profileInfo.platform] = remoteVersions?.buildVersion;
      }
    }
    if (flags.json) {
      const jsonResults: { versionCode?: string; buildNumber?: string } = {};
      if (results.android) {
        jsonResults.versionCode = results.android;
      }
      if (results.ios) {
        jsonResults.buildNumber = results.ios;
      }
      printJsonOnlyOutput(jsonResults);
    } else {
      if (Object.keys(results).length === 0) {
        Log.log('No remote versions are configured for this project.');
        return;
      }
      if (results.android) {
        Log.log(`Android versionCode - ${chalk.bold(results.android)}`);
      }
      if (results.ios) {
        Log.log(`iOS buildNumber - ${chalk.bold(results.ios)}`);
      }
    }
  }
}
