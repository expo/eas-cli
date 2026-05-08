import { Platform } from '@expo/eas-build-job';
import { Updates } from '@expo/config-plugins';
import { Errors, Flags } from '@oclif/core';
import fs from 'fs';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { EmbeddedUpdateAssetMutation } from '../../graphql/mutations/EmbeddedUpdateAssetMutation';
import {
  EmbeddedUpdateMutation,
  EmbeddedUpdateResult,
  isEmbeddedUpdateAssetNotReadyError,
  isEmbeddedUpdateConflictError,
} from '../../graphql/mutations/EmbeddedUpdateMutation';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { readEmbeddedManifest } from '../../update/embeddedManifest';
import { PresignedPost, uploadWithPresignedPostWithRetryAsync } from '../../uploads';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { sleepAsync } from '../../utils/promise';

const MAX_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 3_000;
const RETRY_MAX_DELAY_MS = 10_000;

export default class UpdateUploadEmbedded extends EasCommand {
  static override description =
    'upload the JS bundle embedded in a native build so EAS Update can generate bsdiff patches against it';

  static override examples = [
    '$ eas update:upload-embedded --platform ios --bundle ios/build/App.app/main.jsbundle --manifest ios/build/App.app/app.manifest --channel production',
    '$ eas update:upload-embedded --platform android --bundle android/app/src/main/assets/index.android.bundle --manifest android/app/src/main/assets/app.manifest --channel production --build-id <BUILD-ID>',
  ];

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description: 'Platform of the embedded bundle',
      options: [Platform.IOS, Platform.ANDROID] as const,
      required: true,
    })(),
    bundle: Flags.string({
      description: 'Path to the embedded JS bundle file',
      required: true,
    }),
    manifest: Flags.string({
      description: 'Path to the app.manifest file embedded in the build',
      required: true,
    }),
    channel: Flags.string({
      description: 'Channel name the embedded update should be associated with',
      required: true,
    }),
    'build-id': Flags.string({
      description:
        'EAS Build ID that produced this binary (required when invoked from EAS Build)',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateUploadEmbedded);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const platform = flags.platform;
    const bundlePath = flags.bundle;
    const manifestPath = flags.manifest;
    const channelName = flags.channel;
    const buildId = flags['build-id'];

    const {
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId, exp, projectDir },
    } = await this.getContextAsync(UpdateUploadEmbedded, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!fs.existsSync(bundlePath)) {
      Errors.error(
        `Bundle file not found at "${bundlePath}". Check that the path is correct and points to the JS bundle in your native build output.`,
        { exit: 1 }
      );
    }

    if (!fs.existsSync(manifestPath)) {
      Errors.error(
        `Manifest file not found at "${manifestPath}". Check that the path points to the app.manifest in your native build output ` +
          `(iOS: <App>.app/app.manifest, Android: assets/app.manifest).`,
        { exit: 1 }
      );
    }

    const { id: embeddedUpdateId } = readEmbeddedManifest(manifestPath);

    const runtimeVersion = await Updates.getRuntimeVersionNullableAsync(projectDir, exp, platform);
    if (runtimeVersion === null) {
      Errors.error(
        `Could not resolve runtimeVersion for platform "${platform}". ` +
          `Ensure runtimeVersion is set in your app.json under the expo key.`,
        { exit: 1 }
      );
    }

    const appPlatform = toAppPlatform(platform);
    const channel = await ChannelQuery.viewUpdateChannelBasicInfoAsync(graphqlClient, {
      appId: projectId,
      channelName,
    });
    const channelId = channel.id;

    Log.log(
      `Uploading embedded ${platform} bundle to channel "${channelName}"` +
        (buildId ? ` (build ${buildId})` : '')
    );

    const contentType = 'application/javascript';
    const uploadSpec = await EmbeddedUpdateAssetMutation.getSignedUploadSpecAsync(graphqlClient, {
      appId: projectId,
      contentType,
    });
    const presignedPost: PresignedPost = {
      url: uploadSpec.presignedUrl,
      fields: uploadSpec.fields,
    };
    await uploadWithPresignedPostWithRetryAsync(bundlePath, presignedPost, () => {
      Log.debug('Uploading bundle...');
    });

    Log.debug(
      `Bundle uploaded. storageKey: ${uploadSpec.storageKey}, embeddedUpdateId: ${embeddedUpdateId}, runtimeVersion: ${runtimeVersion}, channelId: ${channelId}`
    );

    let embeddedUpdate: EmbeddedUpdateResult | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        embeddedUpdate = await EmbeddedUpdateMutation.uploadEmbeddedUpdateAsync(graphqlClient, {
          appId: projectId,
          platform: appPlatform,
          runtimeVersion,
          channelId,
          embeddedUpdateId,
          launchAssetStorageKey: uploadSpec.storageKey,
          turtleBuildId: buildId,
        });
        break;
      } catch (e: unknown) {
        if (isEmbeddedUpdateConflictError(e)) {
          Errors.error(
            `An embedded update is already registered for this build (manifest id: ${embeddedUpdateId}). ` +
              `Each native binary can only have one embedded update. ` +
              `If you re-ran this command by mistake, no action is needed. ` +
              `To replace the existing registration, delete it from the Expo dashboard first, then re-run this command.`,
            { exit: 1 }
          );
        }
        const delayMs = attempt < MAX_ATTEMPTS
          ? Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
          : undefined;
        if (isEmbeddedUpdateAssetNotReadyError(e) && delayMs !== undefined) {
          Log.log(
            `Asset not yet finalized, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`
          );
          await sleepAsync(delayMs);
          continue;
        }
        throw e;
      }
    }

    if (embeddedUpdate === undefined) {
      throw new Error(
        `The uploaded bundle was not processed after ${MAX_ATTEMPTS} attempts. ` +
          `Storage finalization is taking longer than expected — wait a moment and try re-running the command.`
      );
    }

    Log.log(
      `Embedded update registered: ${embeddedUpdate.id} (${platform}, runtimeVersion ${runtimeVersion}, channel "${channelName}")`
    );

    if (jsonFlag) {
      printJsonOnlyOutput(embeddedUpdate);
    }
  }
}
