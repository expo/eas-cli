import { EasJson as DeprecatedEasJson } from '../DeprecatedEasJsonReader';
import { migrateProfile } from '../migrate';

test('migration for default manged eas.json', async () => {
  const easJson = {
    builds: {
      android: {
        release: {
          buildType: 'app-bundle',
        },
        development: {
          buildType: 'development-client',
          distribution: 'internal',
        },
      },
      ios: {
        release: {
          buildType: 'release',
        },
        development: {
          buildType: 'development-client',
          distribution: 'internal',
        },
      },
    },
  } as DeprecatedEasJson;
  expect(migrateProfile(easJson, 'release')).toEqual({
    android: {
      buildType: 'app-bundle',
    },
  });
  expect(migrateProfile(easJson, 'development')).toEqual({
    developmentClient: true,
    distribution: 'internal',
  });
});

test('migration for default generic eas.json', async () => {
  const easJson = {
    builds: {
      android: {
        release: {
          gradleCommand: ':app:bundleRelease',
        },
        development: {
          gradleCommand: ':app:assembleDebug',
          distribution: 'internal',
        },
      },
      ios: {
        release: {
          schemeBuildConfiguration: 'Release',
        },
        development: {
          schemeBuildConfiguration: 'Debug',
          distribution: 'internal',
        },
      },
    },
  } as DeprecatedEasJson;
  expect(migrateProfile(easJson, 'release')).toEqual({
    android: {
      gradleCommand: ':app:bundleRelease',
    },
    ios: {
      buildConfiguration: 'Release',
    },
  });
  expect(migrateProfile(easJson, 'development')).toEqual({
    distribution: 'internal',
    android: {
      gradleCommand: ':app:assembleDebug',
    },
    ios: {
      buildConfiguration: 'Debug',
    },
  });
});

test('migration for example manged eas.json', async () => {
  const easJson = {
    builds: {
      android: {
        base: {
          image: 'default',
          env: {
            EXAMPLE_ENV: 'example value',
          },
        },
        release: {
          extends: 'base',
          env: {
            ENVIRONMENT: 'production',
          },
          buildType: 'app-bundle',
        },
        staging: {
          extends: 'base',
          env: {
            ENVIRONMENT: 'staging',
          },
          distribution: 'internal',
          buildType: 'apk',
        },
        debug: {
          extends: 'base',
          withoutCredentials: true,
          env: {
            ENVIRONMENT: 'staging',
          },
          distribution: 'internal',
          buildType: 'development-client',
        },
      },
      ios: {
        base: {
          image: 'latest',
          node: '12.13.0',
          yarn: '1.22.5',
        },
        release: {
          extends: 'base',
          buildType: 'release',
          env: {
            ENVIRONMENT: 'production',
          },
        },
        inhouse: {
          extends: 'base',
          distribution: 'internal',
          enterpriseProvisioning: 'universal',
          env: {
            ENVIRONMENT: 'staging',
          },
        },
        adhoc: {
          extends: 'base',
          distribution: 'internal',
          env: {
            ENVIRONMENT: 'staging',
          },
        },
        client: {
          extends: 'adhoc',
          buildType: 'development-client',
        },
      },
    },
  } as DeprecatedEasJson;
  expect(migrateProfile(easJson, 'base')).toEqual({
    android: {
      env: {
        EXAMPLE_ENV: 'example value',
      },
      image: 'default',
    },
    ios: {
      image: 'latest',
      node: '12.13.0',
      yarn: '1.22.5',
    },
  });
  expect(migrateProfile(easJson, 'release')).toEqual({
    extends: 'base',
    android: {
      buildType: 'app-bundle',
      env: {
        ENVIRONMENT: 'production',
      },
    },
    ios: {
      env: {
        ENVIRONMENT: 'production',
      },
    },
  });
  expect(migrateProfile(easJson, 'staging')).toEqual({
    android: {
      buildType: 'apk',
      distribution: 'internal',
      env: {
        ENVIRONMENT: 'staging',
      },
    },
  });
  expect(migrateProfile(easJson, 'inhouse')).toEqual({
    ios: {
      distribution: 'internal',
      enterpriseProvisioning: 'universal',
      env: {
        ENVIRONMENT: 'staging',
      },
    },
  });
});

test('migration for example generic eas.json', async () => {
  const easJson = {
    builds: {
      android: {
        base: {
          image: 'ubuntu-18.04-android-30-ndk-r19c',
          ndk: '21.4.7075529',
          env: {
            EXAMPLE_ENV: 'example value',
          },
        },
        release: {
          extends: 'base',
          env: {
            ENVIRONMENT: 'production',
          },
          gradleCommand: ':app:bundleRelease',
        },
        staging: {
          extends: 'base',
          env: {
            ENVIRONMENT: 'staging',
          },
          distribution: 'internal',
          gradleCommand: ':app:assembleRelease',
        },
        debug: {
          extends: 'base',
          withoutCredentials: true,
          env: {
            ENVIRONMENT: 'staging',
          },
          distribution: 'internal',
          gradleCommand: ':app:assembleDebug',
        },
      },
      ios: {
        base: {
          image: 'latest',
          node: '12.13.0',
          yarn: '1.22.5',
        },
        release: {
          extends: 'base',
          schemeBuildConfiguration: 'Release',
          scheme: 'testapp',
          env: {
            ENVIRONMENT: 'production',
          },
        },
        inhouse: {
          extends: 'base',
          distribution: 'internal',
          enterpriseProvisioning: 'universal',
          scheme: 'testapp-enterprise',
          env: {
            ENVIRONMENT: 'staging',
          },
        },
        adhoc: {
          extends: 'base',
          distribution: 'internal',
          scheme: 'testapp',
          env: {
            ENVIRONMENT: 'staging',
          },
        },
      },
    },
  } as DeprecatedEasJson;
  expect(migrateProfile(easJson, 'base')).toEqual({
    android: {
      env: {
        EXAMPLE_ENV: 'example value',
      },
      image: 'ubuntu-18.04-android-30-ndk-r19c',
      ndk: '21.4.7075529',
    },
    ios: {
      image: 'latest',
      node: '12.13.0',
      yarn: '1.22.5',
    },
  });
  expect(migrateProfile(easJson, 'release')).toEqual({
    extends: 'base',
    android: {
      env: {
        ENVIRONMENT: 'production',
      },
      gradleCommand: ':app:bundleRelease',
    },
    ios: {
      buildConfiguration: 'Release',
      env: {
        ENVIRONMENT: 'production',
      },
      scheme: 'testapp',
    },
  });
});
