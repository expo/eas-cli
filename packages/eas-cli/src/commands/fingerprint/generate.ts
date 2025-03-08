import { Env, Platform } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';

import { getExpoWebsiteBaseUrl } from '../../api';
import { evaluateConfigWithEnvVarsAsync } from '../../build/evaluateConfigWithEnvVarsAsync';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  getFingerprintInfoFromLocalProjectForPlatformsAsync,
  stringToAppPlatform,
} from '../../fingerprint/utils';
import { AppPlatform } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { link } from '../../log';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { getProfilesAsync } from '../../utils/profiles';

export default class FingerprintGenerate extends EasCommand {
  static override description = 'generate fingerprints from the current project';
  static override strict = false;
  static override hidden = true;

  static override examples = [
    '$ eas fingerprint:generate  \t # Generate fingerprint in interactive mode',
    '$ eas fingerprint:generate --profile preview  \t # Generate a fingerprint using the "preview" build profile',
    '$ eas fingerprint:generate --json --non-interactive --platform android  \t # Output fingerprint json to stdout',
  ];

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    profile: Flags.string({
      char: 'e',
      description: 'Name of the build profile from eas.json.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.DynamicProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(FingerprintGenerate);
    const {
      json,
      'non-interactive': nonInteractive,
      platform: platformStringFlag,
      profile: buildProfileName,
    } = flags;

    const {
      projectId,
      privateProjectConfig: { projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
      getDynamicPrivateProjectConfigAsync,
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

    let env: Env | undefined;
    if (buildProfileName) {
      const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
      const buildProfile = (
        await getProfilesAsync({
          type: 'build',
          easJsonAccessor,
          platforms: [appPlatformtoPlatform(platform)],
          profileName: buildProfileName ?? undefined,
          projectDir,
        })
      )[0];
      if (!buildProfile) {
        throw new Error(`Build profile ${buildProfile} not found for platform: ${platform}`);
      }
      const configResult = await evaluateConfigWithEnvVarsAsync({
        buildProfile: buildProfile.profile,
        buildProfileName: buildProfile.profileName,
        graphqlClient,
        getProjectConfig: getDynamicPrivateProjectConfigAsync,
        opts: { env: buildProfile.profile.env },
      });
      env = configResult.env;
    }

    const fingerprint = await getFingerprintInfoFromLocalProjectForPlatformsAsync(
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      [platform],
      { env }
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

async function selectRequestedPlatformAsync(): Promise<AppPlatform> {
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

function appPlatformtoPlatform(appPlatform: AppPlatform): Platform {
  if (appPlatform === AppPlatform.Android) {
    return Platform.ANDROID;
  } else if (appPlatform === AppPlatform.Ios) {
    return Platform.IOS;
  } else {
    throw new Error('Unsupported platform: ' + appPlatform);
  }
}
