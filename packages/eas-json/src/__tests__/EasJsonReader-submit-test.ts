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
      release: {},
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
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: 'abc-123-def-456',
          ascApiKeyId: 'ABCD',
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
    ascApiKeyPath: './path-ABCD.p8',
    ascApiKeyIssuerId: 'abc-123-def-456',
    ascApiKeyId: 'ABCD',
    language: 'en-US',
  });
});

test('ios config with ascApiKey fields set to env var', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: 'some@email.com',
          ascAppId: '1223423523',
          appleTeamId: 'QWERTY',
          ascApiKeyPath: '$ASC_API_KEY_PATH',
          ascApiKeyIssuerId: '$ASC_API_KEY_ISSUER_ID',
          ascApiKeyId: '$ASC_API_KEY_ID',
        },
      },
    },
  });

  try {
    process.env.ASC_API_KEY_PATH = './path-ABCD.p8';
    process.env.ASC_API_KEY_ISSUER_ID = 'abc-123-def-456';
    process.env.ASC_API_KEY_ID = 'ABCD';
    const reader = new EasJsonReader('/project');
    const iosProfile = await reader.readSubmitProfileAsync(Platform.IOS, 'release');

    expect(iosProfile).toEqual({
      appleId: 'some@email.com',
      ascAppId: '1223423523',
      appleTeamId: 'QWERTY',
      ascApiKeyPath: './path-ABCD.p8',
      ascApiKeyIssuerId: 'abc-123-def-456',
      ascApiKeyId: 'ABCD',
      language: 'en-US',
    });
  } finally {
    process.env.ASC_API_KEY_PATH = undefined;
    process.env.ASC_API_KEY_ISSUER_ID = undefined;
    process.env.ASC_API_KEY_ID = undefined;
  }
});
