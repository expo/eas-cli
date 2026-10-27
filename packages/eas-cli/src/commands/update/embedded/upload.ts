import { Platform } from '@expo/eas-build-job';
import { Updates } from '@expo/config-plugins';
import { Errors, Flags } from '@oclif/core';
import fs from 'fs-extra';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { EmbeddedUpdateAssetMutation } from '../../../graphql/mutations/EmbeddedUpdateAssetMutation';
import {
  EmbeddedUpdateMutation,
  EmbeddedUpdateResult,
  isEmbeddedUpdateAlreadyExistsError,
  isEmbeddedUpdateAssetNotAvailableError,
} from '../../../graphql/mutations/EmbeddedUpdateMutation';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import { ora } from '../../../ora';
import { readEmbeddedManifestAsync } from '../../../update/embeddedManifest';
import { uploadWithPresignedPostWithRetryAsync } from '../../../uploads';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import { sleepAsync } from '../../../utils/promise';

const MAX_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 3_000;
const RETRY_MAX_DELAY_MS = 10_000;

export default class UpdateEmbeddedUpload extends EasCommand {
  static override description =
    'upload the JS bundle embedded in a native build so EAS Update can generate bsdiff patches against it';

  static override examples = [
    '$ eas update:embedded:upload --platform ios --bundle ios/build/App.app/main.jsbundle --manifest ios/build/App.app/app.manifest --channel production',
    '$ eas update:embedded:upload --platform android --bundle android/app/src/main/assets/index.android.bundle --manifest android/app/src/main/assets/app.manifest --channel production --build-id <BUILD-ID>',
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
      description: 'EAS Build ID that produced this binary (required when invoked from EAS Build)',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateEmbeddedUpload);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const platform = flags.platform;
    const bundlePath = flags.bundle;
    const manifestPath = flags.manifest;
    const channelName = flags.channel;
    const buildId = flags['build-id'];

    const {
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId, exp, projectDir },
    } = await this.getContextAsync(UpdateEmbeddedUpload, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!(await fs.pathExists(bundlePath))) {
      Errors.error(
        `Bundle file not found at "${bundlePath}". Check that the path is correct and points to the JS bundle in your native build output.`,
        { exit: 1 }
      );
    }

    const { id: embeddedUpdateId } = await readEmbeddedManifestAsync(manifestPath);

    const runtimeVersion = await Updates.getRuntimeVersionNullableAsync(projectDir, exp, platform);
    if (runtimeVersion === null) {
      Errors.error(
        `Could not resolve runtimeVersion for platform "${platform}". ` +
          `Ensure runtimeVersion is set in your app.json under the expo key.`,
        { exit: 1 }
      );
    }

    const appPlatform = toAppPlatform(platform);

    const uploadSpinner = ora('Uploading bundle...').start();

    const contentType = 'application/javascript';
    const uploadSpec = await EmbeddedUpdateAssetMutation.getSignedUploadSpecAsync(graphqlClient, {
      appId: projectId,
      embeddedUpdateId,
      contentType,
    });
    await uploadWithPresignedPostWithRetryAsync(
      bundlePath,
      { url: uploadSpec.presignedUrl, fields: uploadSpec.fields },
      () => {}
    );

    uploadSpinner.succeed('Uploaded bundle');

    const registerSpinner = ora('Registering embedded update...').start();

    let embeddedUpdate: EmbeddedUpdateResult | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        embeddedUpdate = await EmbeddedUpdateMutation.uploadEmbeddedUpdateAsync(graphqlClient, {
          appId: projectId,
          platform: appPlatform,
          runtimeVersion,
          channel: channelName,
          embeddedUpdateId,
          turtleBuildId: buildId,
        });
        break;
      } catch (e: unknown) {
        if (isEmbeddedUpdateAssetNotAvailableError(e)) {
          if (attempt < MAX_ATTEMPTS) {
            await sleepAsync(
              Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
            );
          }
          continue;
        }

        registerSpinner.fail('Failed to register embedded update');
        if (isEmbeddedUpdateAlreadyExistsError(e)) {
          Errors.error(
            `An embedded update with id "${embeddedUpdateId}" is already registered for this app. Delete it before re-uploading.`,
            { exit: 1 }
          );
        }
        throw e;
      }
    }

    if (embeddedUpdate === undefined) {
      registerSpinner.fail('Failed to register embedded update');
      throw new Error(
        'Embedded bundle could not be processed in time. Try re-running the command in a moment.'
      );
    }

    registerSpinner.succeed(
      `Registered ${platform} embedded update (runtimeVersion: ${runtimeVersion}, channel: "${channelName}")`
    );
    Log.log(`Embedded update ID: ${embeddedUpdate.id}`);

    if (jsonFlag) {
      printJsonOnlyOutput(embeddedUpdate);
    }
  }
}
