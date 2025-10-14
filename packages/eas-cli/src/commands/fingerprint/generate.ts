import { Env } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';

import { getExpoWebsiteBaseUrl } from '../../api';
import { evaluateConfigWithEnvVarsAsync } from '../../build/evaluateConfigWithEnvVarsAsync';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EasEnvironmentFlagParameters,
  EasNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import {
  appPlatformToPlatform,
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

  static override examples = [
    '$ eas fingerprint:generate  \t # Generate fingerprint in interactive mode',
    '$ eas fingerprint:generate --build-profile preview  \t # Generate a fingerprint using the "preview" build profile',
    '$ eas fingerprint:generate --environment preview  \t # Generate a fingerprint using the "preview" environment',
    '$ eas fingerprint:generate --json --non-interactive --platform android  \t # Output fingerprint json to stdout',
  ];

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    ...EASEnvironmentFlag,
    environment: Flags.string({
      ...EasEnvironmentFlagParameters,
      exclusive: ['build-profile'],
    }),
    'build-profile': Flags.string({
      char: 'e',
      description: 'Name of the build profile from eas.json.',
      exclusive: ['environment'],
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.ServerSideEnvironmentVariables,
    ...this.ContextOptions.DynamicProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(FingerprintGenerate);
    const {
      json,
      'non-interactive': nonInteractive,
      platform: platformStringFlag,
      environment,
      'build-profile': buildProfileName,
    } = flags;

    const {
      projectId,
      privateProjectConfig: { projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
      getDynamicPrivateProjectConfigAsync,
    } = await this.getContextAsync(FingerprintGenerate, {
      nonInteractive,
      withServerSideEnvironment: environment ?? null,
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

    let env: Env | undefined = undefined;
    if (environment) {
      Log.log(`🔧 Using environment: ${environment}`);
      env = { ...(await getServerSideEnvironmentVariablesAsync()), EXPO_NO_DOTENV: '1' };
    } else if (buildProfileName) {
      Log.log(`🔧 Using build profile: ${buildProfileName}`);
      const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
      const buildProfile = (
        await getProfilesAsync({
          type: 'build',
          easJsonAccessor,
          platforms: [appPlatformToPlatform(platform)],
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
