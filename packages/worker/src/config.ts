import path from 'path';

import GCS, { GCSLoggerStream } from '@expo/gcs';
import { BuildPriority, env, Environment, ResourceClass, Worker } from '@expo/turtle-common';

type ReplaceUndefinedWithNull<T> = undefined extends T ? Exclude<T, undefined> | null : T;

function createBase64EnvTransformer<TFieldName extends string>(
  field: TFieldName
): (
  valueRaw: string
) => TFieldName extends keyof Worker.RuntimeConfig
  ? ReplaceUndefinedWithNull<Worker.RuntimeConfig[TFieldName]>
  : null {
  return (valueRaw: string) => {
    const json = JSON.parse(Buffer.from(valueRaw, 'base64').toString('utf8'));
    const value = json?.[field];
    return value ?? null;
  };
}

export default {
  env: env<Environment>('ENVIRONMENT', { oneOf: Environment }),
  port: env('PORT', { defaultValue: 3005, transform: Number }),
  metricsServerPort: env('METRICS_SERVER_PORT', { defaultValue: 3007, transform: Number }),
  workerDescriptionPath: env('WORKER_DESCRIPTION_PATH', {
    defaultValue: '/usr/local/share/eas-build/worker-description',
  }),
  loggers: {
    base: {
      name: env('LOGGER_NAME', { defaultValue: 'turtle-worker' }),
      uploadIntervalMs: env('LOGGER_INTERVAL_MS', { defaultValue: 10000, transform: Number }),
    },
    gcs: {
      compressionMethod: GCSLoggerStream.CompressionMethod.BR,
      signedUploadUrlForLogs: env<GCS.SignedUrl | null>('WORKER_RUNTIME_CONFIG_BASE64', {
        transform: createBase64EnvTransformer('gcsSignedUploadUrlForLogs'),
        defaultValue: null,
      }),
      signedUploadUrlForXcodeBuildLogs: env<GCS.SignedUrl | null>('WORKER_RUNTIME_CONFIG_BASE64', {
        transform: createBase64EnvTransformer('gcsSignedUploadUrlForXcodeBuildLogs'),
        defaultValue: null,
      }),
    },
  },
  buildCache: {
    gcsSignedUploadUrlForBuildCache: env<GCS.SignedUrl | null>('WORKER_RUNTIME_CONFIG_BASE64', {
      transform: createBase64EnvTransformer('gcsSignedUploadUrlForBuildCache'),
      defaultValue: null,
    }),
    gcsSignedBuildCacheDownloadUrl: env<string | null>('WORKER_RUNTIME_CONFIG_BASE64', {
      transform: createBase64EnvTransformer('gcsSignedBuildCacheDownloadUrl'),
      defaultValue: null,
    }),
  },
  priority: env<BuildPriority | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('priority'),
    defaultValue: null,
  }),
  gcsSignedUploadUrlForApplicationArchive: env<GCS.SignedUrl | null>(
    'WORKER_RUNTIME_CONFIG_BASE64',
    {
      transform: createBase64EnvTransformer('gcsSignedUploadUrlForApplicationArchive'),
      defaultValue: null,
    }
  ),
  gcsSignedUploadUrlForBuildArtifacts: env<GCS.SignedUrl | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('gcsSignedUploadUrlForBuildArtifacts'),
    defaultValue: null,
  }),
  workingdir: env('WORKINGDIR', { defaultValue: path.join(__dirname, '../workingdir') }),
  sentry: {
    dsn: env('SENTRY_DSN', { defaultValue: '' }),
  },
  rudderstack: {
    dataPlaneURL: env<string | null>('RUDDERSTACK_DATA_PLANE_URL', { defaultValue: null }),
    writeKey: env<string | null>('RUDDERSTACK_WRITE_KEY', { defaultValue: null }),
  },
  npmCacheUrl: env<string | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('npmCacheUrl'),
    defaultValue: null,
  }),
  nodeJsCacheUrl: env<string | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('nodeJsCacheUrl'),
    defaultValue: null,
  }),
  mavenCacheUrl: env<string | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('mavenCacheUrl'),
    defaultValue: null,
  }),
  cocoapodsCacheUrl: env<string | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('cocoapodsCacheUrl'),
    defaultValue: null,
  }),
  runMetricsServer: env<boolean | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('runMetricsServer'),
    defaultValue: null,
  }),
  resourceClass: env<ResourceClass | null>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('resourceClass'),
    defaultValue: null,
  }),
  buildId: env<string>('WORKER_RUNTIME_CONFIG_BASE64', {
    transform: createBase64EnvTransformer('buildId'),
  }),
  wwwApiV2BaseUrl:
    process.env.ENVIRONMENT === 'development'
      ? 'http://api.expo.test/v2/'
      : process.env.ENVIRONMENT === 'staging'
        ? 'https://staging-api.expo.dev/v2/'
        : 'https://api.expo.dev/v2/',
};
