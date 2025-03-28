import { Platform, SubmissionConfig } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import nullthrows from 'nullthrows';
import { z } from 'zod';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AndroidSubmissionConfigInput,
  IosSubmissionConfigInput,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
} from '../../graphql/generated';
import { AppStoreConnectApiKeyQuery } from '../../graphql/queries/AppStoreConnectApiKeyQuery';
import { GoogleServiceAccountKeyQuery } from '../../graphql/queries/GoogleServiceAccountKeyQuery';
import AndroidSubmitCommand from '../../submit/android/AndroidSubmitCommand';
import { SubmissionContext, createSubmissionContextAsync } from '../../submit/context';
import IosSubmitCommand from '../../submit/ios/IosSubmitCommand';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import GitClient from '../../vcs/clients/git';

/**
 * This command will be run on the EAS workers.
 * This command resolves credentials and other
 * configuration, that normally would be included in the
 * job and metadata objects, and prints them to stdout.
 */
export default class SubmitInternal extends EasCommand {
  static override hidden = true;

  static override flags = {
    platform: Flags.enum<Platform>({
      options: [Platform.ANDROID, Platform.IOS],
      required: true,
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
    id: Flags.string({
      description: 'ID of the build to submit',
      required: true,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SubmitInternal);
    // This command is always run with implicit --non-interactive and --json options
    enableJsonOutput();

    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig: { exp, projectId, projectDir },
      analytics,
      vcsClient,
    } = await this.getContextAsync(SubmitInternal, {
      nonInteractive: true,
      withServerSideEnvironment: null,
    });

    if (vcsClient instanceof GitClient) {
      // `build:internal` is run on EAS workers and the repo may have been changed
      // by pre-install hooks or other scripts. We don't want to require committing changes
      // to continue the build.
      vcsClient.requireCommit = false;
    }

    const submissionProfile = await EasJsonUtils.getSubmitProfileAsync(
      EasJsonAccessor.fromProjectPath(projectDir),
      flags.platform,
      flags.profile
    );

    const ctx = await createSubmissionContextAsync({
      platform: flags.platform,
      projectDir,
      profile: submissionProfile,
      archiveFlags: {
        id: flags.id,
      },
      nonInteractive: true,
      isVerboseFastlaneEnabled: false,
      actor,
      graphqlClient,
      analytics,
      exp,
      projectId,
      vcsClient,
      specifiedProfile: flags.profile,
    });

    let config;

    if (ctx.platform === Platform.IOS) {
      const command = new IosSubmitCommand(ctx as SubmissionContext<Platform.IOS>);
      const submitter = await command.runAsync();
      const mutationInput = await submitter.getSubmissionInputAsync();
      const iosConfig = mutationInput.submissionConfig;

      const ascApiKeyJson = await getAppStoreConnectApiKeyJsonAsync({
        iosConfig,
        graphqlClient,
      });

      const configInput: z.input<typeof SubmissionConfig.Ios.SchemaZ> = {
        ascAppIdentifier: iosConfig.ascAppIdentifier,
        isVerboseFastlaneEnabled: iosConfig.isVerboseFastlaneEnabled ?? undefined,
        ...(ascApiKeyJson
          ? { ascApiJsonKey: ascApiKeyJson }
          : {
              appleIdUsername: nullthrows(iosConfig.appleIdUsername),
              appleAppSpecificPassword: nullthrows(iosConfig.appleAppSpecificPassword),
            }),
      };

      config = SubmissionConfig.Ios.SchemaZ.parse(configInput);
    } else if (ctx.platform === Platform.ANDROID) {
      const command = new AndroidSubmitCommand(ctx as SubmissionContext<Platform.ANDROID>);
      const submitter = await command.runAsync();
      const mutationInput = await submitter.getSubmissionInputAsync();
      const androidConfig = mutationInput.submissionConfig;

      const changesNotSentForReview = androidConfig.changesNotSentForReview ?? undefined;
      const releaseStatus = androidConfig.releaseStatus
        ? graphQlReleaseStatusToConfigReleaseStatus[androidConfig.releaseStatus]
        : undefined;
      const googleServiceAccountKeyJson = nullthrows(
        await getGoogleServiceAccountKeyJsonAsync({
          androidConfig,
          graphqlClient,
        })
      );
      const track = graphQlTrackToConfigTrack[androidConfig.track];

      const configInput: z.input<typeof SubmissionConfig.Android.SchemaZ> = {
        changesNotSentForReview,
        googleServiceAccountKeyJson,
        track,
        ...(releaseStatus === SubmissionConfig.Android.ReleaseStatus.IN_PROGRESS
          ? {
              releaseStatus: SubmissionConfig.Android.ReleaseStatus.IN_PROGRESS,
              rollout: androidConfig.rollout ?? undefined,
            }
          : { releaseStatus }),
      };

      config = SubmissionConfig.Android.SchemaZ.parse(configInput);
    } else {
      throw new Error(`Unsupported platform: ${ctx.platform}`);
    }

    printJsonOnlyOutput({ config });
  }
}

async function getGoogleServiceAccountKeyJsonAsync({
  androidConfig,
  graphqlClient,
}: {
  androidConfig: AndroidSubmissionConfigInput;
  graphqlClient: ExpoGraphqlClient;
}): Promise<string | null> {
  if (androidConfig.googleServiceAccountKeyJson) {
    return androidConfig.googleServiceAccountKeyJson;
  } else if (androidConfig.googleServiceAccountKeyId) {
    const key = await GoogleServiceAccountKeyQuery.getByIdAsync(
      graphqlClient,
      androidConfig.googleServiceAccountKeyId
    );

    return key.keyJson;
  }

  return null;
}

async function getAppStoreConnectApiKeyJsonAsync({
  iosConfig,
  graphqlClient,
}: {
  iosConfig: IosSubmissionConfigInput;
  graphqlClient: ExpoGraphqlClient;
}): Promise<string | null> {
  if (iosConfig.ascApiKey) {
    return JSON.stringify({
      key_id: iosConfig.ascApiKey.keyIdentifier,
      issuer_id: iosConfig.ascApiKey.issuerIdentifier,
      key: iosConfig.ascApiKey.keyP8,
    });
  } else if (iosConfig.ascApiKeyId) {
    const key = await AppStoreConnectApiKeyQuery.getByIdAsync(graphqlClient, iosConfig.ascApiKeyId);

    return JSON.stringify({
      key_id: key.keyIdentifier,
      issuer_id: key.issuerIdentifier,
      key: key.keyP8,
    });
  }

  return null;
}

const graphQlReleaseStatusToConfigReleaseStatus = {
  [SubmissionAndroidReleaseStatus.Draft]: SubmissionConfig.Android.ReleaseStatus.DRAFT,
  [SubmissionAndroidReleaseStatus.InProgress]: SubmissionConfig.Android.ReleaseStatus.IN_PROGRESS,
  [SubmissionAndroidReleaseStatus.Completed]: SubmissionConfig.Android.ReleaseStatus.COMPLETED,
  [SubmissionAndroidReleaseStatus.Halted]: SubmissionConfig.Android.ReleaseStatus.HALTED,
};

const graphQlTrackToConfigTrack = {
  [SubmissionAndroidTrack.Production]: SubmissionConfig.Android.ReleaseTrack.PRODUCTION,
  [SubmissionAndroidTrack.Beta]: SubmissionConfig.Android.ReleaseTrack.BETA,
  [SubmissionAndroidTrack.Alpha]: SubmissionConfig.Android.ReleaseTrack.ALPHA,
  [SubmissionAndroidTrack.Internal]: SubmissionConfig.Android.ReleaseTrack.INTERNAL,
};
