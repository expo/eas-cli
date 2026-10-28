import { UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { downloadBuildAsync } from '../functions/downloadBuild';
import { type IosAppIdentity } from './iosAppArtifact';

export function createWarmExpoGoInputProvider(): ReturnType<typeof BuildStepInput.createProvider> {
  return BuildStepInput.createProvider({
    id: 'expo_go',
    required: false,
    allowedValueTypeName: BuildStepInputValueTypeName.JSON,
  });
}

/** Keep the requested archive available for cold fallback without downloading it twice. */
export function createExpoGoAppResolver({
  ctx,
  inputs,
  logger,
  signal,
}: {
  ctx: CustomBuildContext;
  inputs: Record<string, { value: unknown }>;
  logger: bunyan;
  signal?: AbortSignal;
}): (preinstalled?: IosAppIdentity) => Promise<typeof inputs> {
  let download: ReturnType<typeof downloadBuildAsync> | undefined;
  return async preinstalled => {
    signal?.throwIfAborted();
    if (inputs.expo_go?.value === undefined) {
      return inputs;
    }
    const source = z
      .object({
        application_archive_url: z
          .string()
          .url()
          .refine(url => ['http:', 'https:'].includes(new URL(url).protocol)),
        version: z.string().min(1),
      })
      .strict()
      .parse(inputs.expo_go.value);
    if (inputs.install_app_path?.value || inputs.launch_app_identifier?.value) {
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        'Pass expo_go or install_app_path/launch_app_identifier, not both.'
      );
    }
    if (
      preinstalled?.bundleIdentifier === 'host.exp.Exponent' &&
      preinstalled.shortVersion === source.version &&
      preinstalled.version === source.version
    ) {
      logger.info(
        `Expo Go ${source.version} is already installed; skipping download and installation.`
      );
      return {
        ...inputs,
        expo_go: { value: undefined },
        install_app_path: { value: undefined },
        launch_app_identifier: { value: preinstalled.bundleIdentifier },
      };
    }
    logger.info(
      `Downloading the requested Expo Go ${source.version}; no matching warm preinstall is available.`
    );
    download ??= downloadBuildAsync({
      applicationArchiveUrl: source.application_archive_url,
      graphqlClient: ctx.graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
      logger,
      signal,
    });
    const { artifactPath } = await download;
    signal?.throwIfAborted();
    return { ...inputs, expo_go: { value: undefined }, install_app_path: { value: artifactPath } };
  };
}
