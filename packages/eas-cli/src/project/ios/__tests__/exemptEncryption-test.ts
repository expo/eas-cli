import { getConfig } from '@expo/config';
import { vol } from 'memfs';

import * as prompts from '../../../prompts';
import { ensureNonExemptEncryptionIsDefinedForManagedProjectAsync } from '../exemptEncryption';

jest.mock('fs');
jest.mock('../../../prompts');

// @expo/require-utils uses require() to load JS configs, which bypasses the
// mocked fs. Override loadModuleSync to read from the mocked fs and evaluate.
jest.mock('@expo/require-utils', () => {
  const actual = jest.requireActual('@expo/require-utils');
  return {
    ...actual,
    loadModuleSync: (filename: string) => {
      const fs = require('fs');
      const content = fs.readFileSync(filename, 'utf-8');
      const mod = { exports: {} as any };
      // eslint-disable-next-line no-new-func
      new Function('module', 'exports', content)(mod, mod.exports);
      return mod.exports;
    },
  };
});

beforeEach(async () => {
  jest.resetAllMocks();
  vol.reset();
});

test('prompts non-exempt encryption is not used', async () => {
  const projectRoot = '/project';
  vol.fromJSON(
    {
      'package.json': JSON.stringify({}),
      'app.json': JSON.stringify({
        expo: {
          name: 'myproject',
          slug: 'myproject',
        },
      }),
    },
    projectRoot
  );

  jest.mocked(prompts.confirmAsync).mockReset().mockResolvedValueOnce(true);

  await ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
    projectDir: projectRoot,
    exp: getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
    nonInteractive: false,
  });

  expect(getConfig(projectRoot, { skipSDKVersionRequirement: true }).rootConfig).toEqual({
    expo: {
      ios: {
        infoPlist: {
          ITSAppUsesNonExemptEncryption: false,
        },
      },
      name: 'myproject',
      slug: 'myproject',
    },
  });
});

test('does not prompt if the value is already set', async () => {
  const projectRoot = '/project';
  vol.fromJSON(
    {
      'package.json': JSON.stringify({}),
      'app.json': JSON.stringify({
        name: 'myproject',
        slug: 'myproject',
        ios: {
          infoPlist: {
            ITSAppUsesNonExemptEncryption: false,
          },
        },
      }),
    },
    projectRoot
  );

  // Reset but no mock values.
  jest.mocked(prompts.confirmAsync).mockReset();

  await ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
    projectDir: projectRoot,
    exp: getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
    nonInteractive: false,
  });

  expect(prompts.confirmAsync).toHaveBeenCalledTimes(0);

  expect(getConfig(projectRoot, { skipSDKVersionRequirement: true }).rootConfig).toEqual({
    ios: {
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    name: 'myproject',
    slug: 'myproject',
  });
});

test('prompts non-exempt encryption in CI', async () => {
  const projectRoot = '/project';
  vol.fromJSON(
    {
      'package.json': JSON.stringify({}),
      'app.json': JSON.stringify({
        expo: {
          name: 'myproject',
          slug: 'myproject',
        },
      }),
    },
    projectRoot
  );

  // Reset but no mock values.
  jest.mocked(prompts.confirmAsync).mockReset();

  await ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
    projectDir: projectRoot,
    exp: getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
    nonInteractive: false,
  });

  expect(getConfig(projectRoot, { skipSDKVersionRequirement: true }).rootConfig).toEqual({
    expo: {
      ios: {
        infoPlist: {
          ITSAppUsesNonExemptEncryption: false,
        },
      },
      name: 'myproject',
      slug: 'myproject',
    },
  });
});

test('prompts non-exempt encryption is not used but app.config.js', async () => {
  const projectRoot = '/project';
  vol.fromJSON(
    {
      'package.json': JSON.stringify({}),
      'app.config.js':
        `module.exports = ` +
        JSON.stringify({
          expo: {
            name: 'myproject',
            slug: 'myproject',
          },
        }),
    },
    projectRoot
  );

  jest.mocked(prompts.confirmAsync).mockReset().mockResolvedValueOnce(true);

  await ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
    projectDir: projectRoot,
    exp: getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
    nonInteractive: false,
  });

  // Not set.
  expect(getConfig(projectRoot, { skipSDKVersionRequirement: true }).rootConfig).toEqual({});
});

test('prompts non-exempt encryption is used', async () => {
  const projectRoot = '/project';
  vol.fromJSON(
    {
      'package.json': JSON.stringify({}),
      'app.json': JSON.stringify({
        expo: {
          name: 'myproject',
          slug: 'myproject',
        },
      }),
    },
    projectRoot
  );

  jest
    .mocked(prompts.confirmAsync)
    .mockReset()
    .mockResolvedValueOnce(false)
    // Are you sure?
    .mockResolvedValueOnce(true);

  await ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
    projectDir: projectRoot,
    exp: getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
    nonInteractive: false,
  });

  expect(prompts.confirmAsync).toHaveBeenCalledTimes(2);

  expect(getConfig(projectRoot, { skipSDKVersionRequirement: true }).rootConfig).toEqual({
    expo: {
      name: 'myproject',
      slug: 'myproject',
    },
  });
});

test('prompts non-exempt encryption is used but backed out', async () => {
  const projectRoot = '/project';
  vol.fromJSON(
    {
      'package.json': JSON.stringify({}),
      'app.json': JSON.stringify({
        expo: {
          name: 'myproject',
          slug: 'myproject',
        },
      }),
    },
    projectRoot
  );

  jest
    .mocked(prompts.confirmAsync)
    .mockReset()
    .mockResolvedValueOnce(false)
    // Are you sure?
    .mockResolvedValueOnce(false);

  await ensureNonExemptEncryptionIsDefinedForManagedProjectAsync({
    projectDir: projectRoot,
    exp: getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
    nonInteractive: false,
  });

  expect(getConfig(projectRoot, { skipSDKVersionRequirement: true }).rootConfig).toEqual({
    expo: {
      name: 'myproject',
      slug: 'myproject',
      ios: {
        infoPlist: {
          ITSAppUsesNonExemptEncryption: false,
        },
      },
    },
  });
});
