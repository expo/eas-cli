import * as YAML from 'yaml';

export const REPACK_WORKFLOW_FILE_NAME = 'eas-build-repack.yml';
export const REPACK_JOB_KEY = 'repack';

export type IosSigningBackend = 'fastlane' | 'zsign';

export interface RepackWorkflowParams {
  buildId: string;
  /** Build profile to repack with. When omitted, the source build's profile is used. */
  profile?: string;
  /** When omitted, the setting is detected from the source build. */
  embedBundleAssets?: boolean;
  jsBundleOnly?: boolean;
  iosSigningBackend?: IosSigningBackend;
  message?: string;
  /** Environment variables set on the repack job. */
  env?: Record<string, string>;
}

/**
 * Creates the configuration of a workflow with a single `repack` job, which rebuilds
 * the JavaScript bundle of the uploaded project and repacks it into an existing build.
 */
export function createRepackWorkflowYamlConfig({
  buildId,
  profile,
  embedBundleAssets,
  jsBundleOnly,
  iosSigningBackend,
  message,
  env,
}: RepackWorkflowParams): string {
  const params: Record<string, string | boolean> = { build_id: buildId };
  if (profile !== undefined) {
    params.profile = profile;
  }
  if (embedBundleAssets !== undefined) {
    params.embed_bundle_assets = embedBundleAssets;
  }
  if (jsBundleOnly !== undefined) {
    params.js_bundle_only = jsBundleOnly;
  }
  if (iosSigningBackend !== undefined) {
    params.ios_signing_backend = iosSigningBackend;
  }
  if (message !== undefined) {
    params.message = message;
  }

  return YAML.stringify({
    name: 'Repack build',
    jobs: {
      [REPACK_JOB_KEY]: {
        name: 'Repack build',
        type: 'repack',
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        params,
      },
    },
  });
}
