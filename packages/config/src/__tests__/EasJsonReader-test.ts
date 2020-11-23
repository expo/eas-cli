import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonReader } from '../EasJsonReader';

jest.mock('fs');

beforeEach(async () => {
  vol.reset();
  await fs.mkdirp('/project');
});

test('minimal valid android eas.json', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { workflow: 'generic' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      android: {
        workflow: 'generic',
        internal: false,
        credentialsSource: 'auto',
      },
    },
  }).toEqual(easJson);
});

test('minimal valid ios eas.json', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      ios: {
        release: { workflow: 'generic' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'ios');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      ios: {
        credentialsSource: 'auto',
        internal: false,
        workflow: 'generic',
      },
    },
  }).toEqual(easJson);
});

test('minimal valid eas.json for both platforms', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { workflow: 'generic' },
      },
      ios: {
        release: { workflow: 'generic' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'all');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      android: { workflow: 'generic', internal: false, credentialsSource: 'auto' },
      ios: { workflow: 'generic', internal: false, credentialsSource: 'auto' },
    },
  }).toEqual(easJson);
});

test('valid eas.json with both platform, but reading only android', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      ios: {
        release: { workflow: 'generic' },
      },
      android: {
        release: { workflow: 'generic' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      android: { workflow: 'generic', internal: false, credentialsSource: 'auto' },
    },
  }).toEqual(easJson);
});

test('valid eas.json for debug builds', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      ios: {
        release: { workflow: 'managed' },
        debug: { workflow: 'managed', buildType: 'simulator' },
      },
      android: {
        release: { workflow: 'generic' },
        debug: {
          workflow: 'generic',
          gradleCommand: ':app:assembleDebug',
          withoutCredentials: true,
        },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'all');
  const easJson = await reader.readAsync('debug');
  expect({
    builds: {
      android: {
        credentialsSource: 'auto',
        workflow: 'generic',
        gradleCommand: ':app:assembleDebug',
        withoutCredentials: true,
        internal: false,
      },
      ios: {
        credentialsSource: 'auto',
        workflow: 'managed',
        buildType: 'simulator',
        internal: false,
      },
    },
  }).toEqual(easJson);
});

test('invalid eas.json with missing preset', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { workflow: 'generic' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('debug');
  await expect(promise).rejects.toThrowError(
    'There is no profile named debug for platform android'
  );
});

test('invalid eas.json when using buildType for wrong platform', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { workflow: 'managed', buildType: 'archive' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('release');
  await expect(promise).rejects.toThrowError(
    'Object "android.release" in eas.json is not valid [ValidationError: "buildType" must be one of [apk, app-bundle]]'
  );
});

test('invalid eas.json when missing workflow', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { buildType: 'apk' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('release');
  await expect(promise).rejects.toThrowError(
    'eas.json is not valid [ValidationError: "builds.android.release.workflow" is required]'
  );
});

test('empty json', async () => {
  await fs.writeJson('/project/eas.json', {});

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('release');
  await expect(promise).rejects.toThrowError(
    'There is no profile named release for platform android'
  );
});
