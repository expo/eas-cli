import { SubmitProfile } from '@expo/eas-json';
import path from 'path';

import { getStaticConfigFilePath, loadConfigAsync } from '../config/resolve';
import { MetadataValidationError } from '../errors';

describe(getStaticConfigFilePath, () => {
  const projectDir = '/app';

  function mockProfile(metadataPath: string): SubmitProfile {
    return { metadataPath } as any;
  }

  it(`returns same file for store.config.json`, () => {
    expect(getStaticConfigFilePath({ projectDir, profile: mockProfile('store.config.json') })).toBe(
      path.join(projectDir, 'store.config.json')
    );
  });

  it(`returns store.config.json for store.config.js`, () => {
    expect(getStaticConfigFilePath({ projectDir, profile: mockProfile('store.config.js') })).toBe(
      path.join(projectDir, 'store.config.json')
    );
  });

  it(`returns store.staging.json file for store.staging.js`, () => {
    expect(getStaticConfigFilePath({ projectDir, profile: mockProfile('store.staging.js') })).toBe(
      path.join(projectDir, 'store.staging.json')
    );
  });

  // This shouldn't be used IRL, but it tests if this function is working properly
  it(`returns custom-name.json file for custom-name.js`, () => {
    expect(getStaticConfigFilePath({ projectDir, profile: mockProfile('custom-name.js') })).toBe(
      path.join(projectDir, 'custom-name.json')
    );
  });
});

describe(loadConfigAsync, () => {
  const projectDir = path.resolve(__dirname, 'fixtures');

  function mockProfile(metadataPath: string): SubmitProfile {
    return { metadataPath } as any;
  }

  it(`throws when file doesn't exist`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('doesnt-exist.json') })
    ).rejects.toThrow('file not found');
  });

  it(`throws when validation errors are found without skipping validation`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('invalid.config.json') })
    ).rejects.toThrow('errors found');
  });

  it(`returns config from "store.config.json"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('store.config.json') })
    ).resolves.toHaveProperty('apple.copyright', 'ACME');
  });

  it(`returns config from "store.config.js"`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('store.config.js') })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns config from "store.function.js"`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('store.function.js') })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns config from "store.async.js"`, async () => {
    const year = new Date().getFullYear();
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('store.async.js') })
    ).resolves.toHaveProperty('apple.copyright', `${year} ACME`);
  });

  it(`returns invalid config from "invalid.config.json`, async () => {
    await expect(
      loadConfigAsync({
        projectDir,
        profile: mockProfile('invalid.config.json'),
        skipValidation: true,
      })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.config.js`, async () => {
    await expect(
      loadConfigAsync({
        projectDir,
        profile: mockProfile('invalid.config.js'),
        skipValidation: true,
      })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.function.js`, async () => {
    await expect(
      loadConfigAsync({
        projectDir,
        profile: mockProfile('invalid.function.js'),
        skipValidation: true,
      })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`returns invalid config from "invalid.async.js`, async () => {
    await expect(
      loadConfigAsync({
        projectDir,
        profile: mockProfile('invalid.async.js'),
        skipValidation: true,
      })
    ).resolves.toMatchObject({ configVersion: -1 });
  });

  it(`throws invalid config type from "invalid-type.config.json"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('invalid-type.config.json') })
    ).rejects.toThrow(MetadataValidationError);
  });

  it(`throws invalid config type from "invalid-type.config.js"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('invalid-type.config.js') })
    ).rejects.toThrow(MetadataValidationError);
  });

  it(`throws invalid config type from "invalid-type.function.js"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('invalid-type.function.js') })
    ).rejects.toThrow(MetadataValidationError);
  });

  it(`throws invalid config type from "invalid-type.async.js"`, async () => {
    await expect(
      loadConfigAsync({ projectDir, profile: mockProfile('invalid-type.async.js') })
    ).rejects.toThrow(MetadataValidationError);
  });
});
