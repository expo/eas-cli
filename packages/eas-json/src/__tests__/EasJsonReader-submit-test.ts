import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonReader } from '../EasJsonReader';

jest.mock('fs');

beforeEach(async () => {
  vol.reset();
  await fs.mkdirp('/project');
});

test('minimal allowed eas.json for both platforms', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        android: {},
        ios: {},
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const iosProfile = await reader.readSubmitProfileAsync('release', Platform.IOS);
  const androidProfile = await reader.readSubmitProfileAsync('release', Platform.ANDROID);

  expect(androidProfile).toEqual({});
  expect(iosProfile).toEqual({});
});

test('android config with all required values', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: 'completed',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const androidProfile = await reader.readSubmitProfileAsync('release', Platform.ANDROID);

  expect(androidProfile).toEqual({
    serviceAccountKeyPath: './path.json',
    track: 'beta',
    releaseStatus: 'completed',
  });
});

test('ios config with all required values', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: 'some@email.com',
          ascAppId: '1223423523',
          appleTeamId: 'QWERTY',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const iosProfile = await reader.readSubmitProfileAsync('release', Platform.IOS);

  expect(iosProfile).toEqual({
    appleId: 'some@email.com',
    appleTeamId: 'QWERTY',
    ascAppId: '1223423523',
  });
});

test('missing ios profile', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: 'completed',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.readSubmitProfileAsync('release', Platform.IOS);

  expect(promise).rejects.toThrow('There is no profile named release in eas.json for ios.');
});
