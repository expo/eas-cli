import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import * as AndroidGraphqlClient from '../../credentials/android/api/GraphqlClient';
import { CredentialsContext } from '../../credentials/context';
import { getAppLookupParamsFromContextAsync } from '../../credentials/android/actions/BuildCredentialsUtils';
import { SelectPlatform } from '../../credentials/manager/SelectPlatform';
import { resolveGradleBuildContextAsync } from '../../project/android/gradle';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override examples = [
    '$ eas credentials --profile development --platform android --json --non-interactive  # Output Android keystore info from development env as JSON',
  ];

  static override flags = {
    platform: Flags.option({ char: 'p', options: ['android', 'ios'] as const })(),
    profile: Flags.string({
      char: 'e',
      description: 'Name of the profile to manage',
      helpValue: 'PROFILE_NAME',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.OptionalProjectConfig,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Credentials);
    const {
      loggedIn: { actor, graphqlClient },
      optionalPrivateProjectConfig: privateProjectConfig,
      getDynamicPrivateProjectConfigAsync,
      analytics,
      vcsClient,
    } = await this.getContextAsync(Credentials, {
      nonInteractive: flags['non-interactive'] ?? false,
      withServerSideEnvironment: null,
    });

    if (flags.json) {
      enableJsonOutput();
    }

    if (
      flags.json &&
      flags['non-interactive'] &&
      flags.platform === 'android'
    ) {
      if (!privateProjectConfig) {
        throw new Error(
          'Run this command from a project directory with app.json and eas.json to output Android keystore info as JSON.'
        );
      }
      const projectDir = privateProjectConfig.projectDir;
      const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
      const profileNames = await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor);
      if (profileNames.length === 0) {
        throw new Error(
          'No build profiles found in eas.json. Add at least one build profile to use this command.'
        );
      }
      const profileName = flags.profile ?? profileNames[0];
      const buildProfile = await EasJsonUtils.getBuildProfileAsync(
        easJsonAccessor,
        Platform.ANDROID,
        profileName
      );
      const { exp, projectId } = await getDynamicPrivateProjectConfigAsync({
        env: buildProfile.env,
      });
      const ctx = new CredentialsContext({
        projectDir,
        projectInfo: { exp, projectId },
        user: actor,
        graphqlClient,
        analytics,
        env: buildProfile.env,
        nonInteractive: true,
        vcsClient,
      });
      const gradleContext = await resolveGradleBuildContextAsync(
        projectDir,
        buildProfile,
        vcsClient
      );
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, gradleContext);
      const defaultBuildCredentials =
        await AndroidGraphqlClient.getDefaultAndroidAppBuildCredentialsAsync(
          graphqlClient,
          appLookupParams
        );
      const keystore = defaultBuildCredentials?.androidKeystore ?? null;
      const output = keystore
        ? {
            keystore: {
              id: keystore.id,
              type: keystore.type,
              keyAlias: keystore.keyAlias,
              md5CertificateFingerprint: keystore.md5CertificateFingerprint ?? null,
              sha1CertificateFingerprint: keystore.sha1CertificateFingerprint ?? null,
              sha256CertificateFingerprint: keystore.sha256CertificateFingerprint ?? null,
              createdAt: keystore.createdAt,
              updatedAt: keystore.updatedAt,
            },
          }
        : { keystore: null };
      printJsonOnlyOutput(output);
      return;
    }

    await new SelectPlatform(
      actor,
      graphqlClient,
      vcsClient,
      analytics,
      privateProjectConfig ?? null,
      getDynamicPrivateProjectConfigAsync,
      {
        flagPlatform: flags.platform,
        flagProfileName: flags.profile,
      }
    ).runAsync();
  }
}
