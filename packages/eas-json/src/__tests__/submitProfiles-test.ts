import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonAccessor } from '../accessor';
import { InvalidEasJsonError } from '../errors';
import { AndroidReleaseStatus } from '../submit/types';
import { EasJsonUtils } from '../utils';

jest.mock('fs');

beforeEach(async () => {
  vol.reset();
  await fs.mkdirp('/project');
});

test('minimal allowed eas.json for both platforms', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {},
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

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
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: 'completed',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

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
      production: {
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
    const accessor = EasJsonAccessor.fromProjectPath('/project');
    const androidProfile = await EasJsonUtils.getSubmitProfileAsync(
      accessor,
      Platform.ANDROID,
      'production'
    );

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
      production: {
        ios: {
          appleId: 'some@email.com',
          ascAppId: '1223423523',
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: 'b4d78f58-48c6-4f2c-96cb-94d8cd76970a',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'production');

  expect(iosProfile).toEqual({
    appleId: 'some@email.com',
    appleTeamId: 'AB32CZE81F',
    ascAppId: '1223423523',
    ascApiKeyPath: './path-ABCD.p8',
    ascApiKeyIssuerId: 'b4d78f58-48c6-4f2c-96cb-94d8cd76970a',
    ascApiKeyId: 'AB32CZE81F',
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
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: '$ASC_API_KEY_PATH',
          ascApiKeyIssuerId: '$ASC_API_KEY_ISSUER_ID',
          ascApiKeyId: '$ASC_API_KEY_ID',
        },
      },
    },
  });

  try {
    process.env.ASC_API_KEY_PATH = './path-ABCD.p8';
    process.env.ASC_API_KEY_ISSUER_ID = 'b4d78f58-48c6-4f2c-96cb-94d8cd76970a';
    process.env.ASC_API_KEY_ID = 'AB32CZE81F';
    const accessor = EasJsonAccessor.fromProjectPath('/project');
    const iosProfile = await EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'release');

    expect(iosProfile).toEqual({
      appleId: 'some@email.com',
      ascAppId: '1223423523',
      appleTeamId: 'AB32CZE81F',
      ascApiKeyPath: './path-ABCD.p8',
      ascApiKeyIssuerId: 'b4d78f58-48c6-4f2c-96cb-94d8cd76970a',
      ascApiKeyId: 'AB32CZE81F',
      language: 'en-US',
    });
  } finally {
    process.env.ASC_API_KEY_PATH = undefined;
    process.env.ASC_API_KEY_ISSUER_ID = undefined;
    process.env.ASC_API_KEY_ID = undefined;
  }
});

test('valid profile with extension chain not exceeding 5', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      base: {
        ios: {
          appleId: 'some@email.com',
          ascAppId: '1223423523',
          appleTeamId: 'AB32CZE81F',
        },
      },
      extension1: {
        extends: 'base',
        ios: {
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
      extension2: {
        extends: 'extension1',
        ios: {
          appleTeamId: 'AB32CZE81E',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81E',
        },
      },
      extension3: {
        extends: 'extension2',
        ios: {
          appleTeamId: 'AB32CZE81D',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81D',
        },
      },
      extension4: {
        extends: 'extension3',
        ios: {
          appleTeamId: 'AB32CZE81C',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81C',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const baseProfile = await EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'base');
  const extendedProfile1 = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.IOS,
    'extension1'
  );
  const extendedProfile2 = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.IOS,
    'extension2'
  );
  const extendedProfile3 = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.IOS,
    'extension3'
  );
  const extendedProfile4 = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.IOS,
    'extension4'
  );
  expect(baseProfile).toEqual({
    language: 'en-US',
    appleId: 'some@email.com',
    ascAppId: '1223423523',
    appleTeamId: 'AB32CZE81F',
  });
  expect(extendedProfile1).toEqual({
    language: 'en-US',
    appleId: 'some@email.com',
    ascAppId: '1223423523',
    appleTeamId: 'AB32CZE81F',
    ascApiKeyPath: './path-ABCD.p8',
    ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
    ascApiKeyId: 'AB32CZE81F',
  });
  expect(extendedProfile2).toEqual({
    language: 'en-US',
    appleId: 'some@email.com',
    ascAppId: '1223423523',
    appleTeamId: 'AB32CZE81E',
    ascApiKeyPath: './path-ABCD.p8',
    ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
    ascApiKeyId: 'AB32CZE81E',
  });
  expect(extendedProfile3).toEqual({
    language: 'en-US',
    appleId: 'some@email.com',
    ascAppId: '1223423523',
    appleTeamId: 'AB32CZE81D',
    ascApiKeyPath: './path-ABCD.p8',
    ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
    ascApiKeyId: 'AB32CZE81D',
  });
  expect(extendedProfile4).toEqual({
    language: 'en-US',
    appleId: 'some@email.com',
    ascAppId: '1223423523',
    appleTeamId: 'AB32CZE81C',
    ascApiKeyPath: './path-ABCD.p8',
    ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
    ascApiKeyId: 'AB32CZE81C',
  });
});

test('valid profile with extension chain exceeding 5 - too long', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      base: {
        ios: {
          appleId: 'some@email.com',
          ascAppId: '1223423523',
          appleTeamId: 'AB32CZE81F',
        },
      },
      extension1: {
        extends: 'base',
        ios: {
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
      extension2: {
        extends: 'extension1',
        ios: {
          appleTeamId: 'AB32CZE81E',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81E',
        },
      },
      extension3: {
        extends: 'extension2',
        ios: {
          appleTeamId: 'AB32CZE81D',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81D',
        },
      },
      extension4: {
        extends: 'extension3',
        ios: {
          appleTeamId: 'AB32CZE81C',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81C',
        },
      },
      extension5: {
        extends: 'extension4',
        ios: {
          appleTeamId: 'AB32CZE81B',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81B',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  await expect(
    EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'extension5')
  ).rejects.toThrow(
    'Too long chain of profile extensions, make sure "extends" keys do not make a cycle'
  );
});

test('ios config with with invalid appleId', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: '| /bin/bash echo "hello"',
          ascAppId: '1223423523',
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'release');
  await expect(promise).rejects.toThrow(
    'Invalid Apple ID was specified. It should be a valid email address. Example: "name@example.com".'
  );
});

test('ios config with with invalid ascAppId', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: 'some@example.com',
          ascAppId: 'othervalue',
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'release');
  await expect(promise).rejects.toThrow(
    'Invalid Apple App Store Connect App ID ("ascAppId") was specified. It should consist only of digits. Example: "1234567891". Learn more: https://expo.fyi/asc-app-id.'
  );
});

test('ios config with with invalid appleTeamId', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: 'some@example.com',
          ascAppId: '1223423523',
          appleTeamId: 'ls -la',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: '2af70a7a-2ac5-44d4-924e-ae97a7ca9333',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'release');
  await expect(promise).rejects.toThrow(
    'Invalid Apple Team ID was specified. It should consist of 10 uppercase letters or digits. Example: "AB32CZE81F".'
  );
});

test('ios config with with invalid ascApiKeyIssuerId', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: 'some@example.com',
          ascAppId: '1223423523',
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: 'notanuuid',
          ascApiKeyId: 'AB32CZE81F',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'release');
  await expect(promise).rejects.toThrow(
    'Invalid Apple App Store Connect API Key Issuer ID ("ascApiKeyIssuerId") was specified. It should be a valid UUID. Example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx". Learn more: https://expo.fyi/creating-asc-api-key.'
  );
});

test('ios config with with invalid ascApiKeyId', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      release: {
        ios: {
          appleId: 'some@example.com',
          ascAppId: '1223423523',
          appleTeamId: 'AB32CZE81F',
          ascApiKeyPath: './path-ABCD.p8',
          ascApiKeyIssuerId: 'b4d78f58-48c6-4f2c-96cb-94d8cd76970a',
          ascApiKeyId: 'wrong value',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.IOS, 'release');
  await expect(promise).rejects.toThrow(
    `Invalid Apple App Store Connect API Key ID ("ascApiKeyId") was specified. It should consist of uppercase letters or digits. Example: "AB32CZE81F". Learn more: https://expo.fyi/creating-asc-api-key.`
  );
});

test('get profile names', async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: 'completed',
        },
      },
      blah: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'internal',
          releaseStatus: 'completed',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const allProfileNames = await EasJsonUtils.getSubmitProfileNamesAsync(accessor);
  expect(allProfileNames.sort()).toEqual(['production', 'blah'].sort());
});

test.each([
  AndroidReleaseStatus.completed,
  AndroidReleaseStatus.draft,
  AndroidReleaseStatus.halted,
])('android config with releaseStatus %s is valid when rollout is not set', async releaseStatus => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    serviceAccountKeyPath: './path.json',
    track: 'beta',
    releaseStatus,
    changesNotSentForReview: false,
  });
});

test.each([
  AndroidReleaseStatus.completed,
  AndroidReleaseStatus.draft,
  AndroidReleaseStatus.halted,
])('android config with releaseStatus %s is invalid when rollout is set', async releaseStatus => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus,
          rollout: 0.5,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(InvalidEasJsonError);
});

test(`android config with releaseStatus ${AndroidReleaseStatus.inProgress} is invalid when rollout is not set`, async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: AndroidReleaseStatus.inProgress,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(InvalidEasJsonError);
  await expect(promise).rejects.toThrowError(/"submit\.production\.android\.rollout" is required/);
});

test(`android config with releaseStatus ${AndroidReleaseStatus.inProgress} is valid when rollout is set`, async () => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: AndroidReleaseStatus.inProgress,
          rollout: 0.5,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    serviceAccountKeyPath: './path.json',
    track: 'beta',
    releaseStatus: AndroidReleaseStatus.inProgress,
    changesNotSentForReview: false,
    rollout: 0.5,
  });
});

test.each([0, 1, 0.2, 0.75, 0.22])('rollout value %s is valid', async rollout => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: AndroidReleaseStatus.inProgress,
          rollout,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getSubmitProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    serviceAccountKeyPath: './path.json',
    track: 'beta',
    releaseStatus: AndroidReleaseStatus.inProgress,
    changesNotSentForReview: false,
    rollout,
  });
});

test.each([-5, 12, 1.2, 1.01, 99])('rollout value %s is invalid', async rollout => {
  await fs.writeJson('/project/eas.json', {
    submit: {
      production: {
        android: {
          serviceAccountKeyPath: './path.json',
          track: 'beta',
          releaseStatus: AndroidReleaseStatus.inProgress,
          rollout,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getSubmitProfileAsync(accessor, Platform.ANDROID, 'production');

  await expect(promise).rejects.toThrowError(InvalidEasJsonError);
});
