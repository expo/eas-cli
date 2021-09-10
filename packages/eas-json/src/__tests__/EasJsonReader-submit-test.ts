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
  const iosProfile = await reader.readSubmitProfileAsync(Platform.IOS, 'release');
  const androidProfile = await reader.readSubmitProfileAsync(Platform.ANDROID, 'release');

  expect(androidProfile).toEqual({
    changesNotSentForReview: false,
    releaseStatus: 'completed',
    track: 'internal',
  });
  expect(iosProfile).toEqual({
    language: 'en-US',
  });
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
  const androidProfile = await reader.readSubmitProfileAsync(Platform.ANDROID, 'release');

  expect(androidProfile).toEqual({
    serviceAccountKeyPath: './path.json',
    track: 'beta',
    releaseStatus: 'completed',
    changesNotSentForReview: false,
  });
});

test('android config with serviceAccountKeyPath set to env var', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        android: {
          serviceAccountKeyPath: '$GOOGLE_SERVICE_ACCOUNT',
          track: 'beta',
          releaseStatus: 'completed',
        },
      },
    },
  });

  try {
    process.env.GOOGLE_SERVICE_ACCOUNT = './path.json';
    const reader = new EasJsonReader('/project');
    const androidProfile = await reader.readSubmitProfileAsync(Platform.ANDROID, 'release');

    expect(androidProfile).toEqual({
      serviceAccountKeyPath: './path.json',
      track: 'beta',
      releaseStatus: 'completed',
      changesNotSentForReview: false,
    });
  } finally {
    process.env.GOOGLE_SERVICE_ACCOUNT = undefined;
  }
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
  const iosProfile = await reader.readSubmitProfileAsync(Platform.IOS, 'release');

  expect(iosProfile).toEqual({
    appleId: 'some@email.com',
    appleTeamId: 'QWERTY',
    ascAppId: '1223423523',
    language: 'en-US',
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
  const promise = reader.readSubmitProfileAsync(Platform.IOS, 'release');

  expect(promise).rejects.toThrow('There is no profile named release in eas.json for ios.');
});
