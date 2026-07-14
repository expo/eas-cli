import fs from 'fs-extra';
import mockdate from 'mockdate';
import { Response } from 'node-fetch';
import path from 'path';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AssetMetadataStatus } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { PublishQuery } from '../../graphql/queries/PublishQuery';
import { RequestedPlatform } from '../../platform';
import { uploadWithPresignedPostWithRetryAsync } from '../../uploads';
import { expoCommandAsync } from '../../utils/expoCli';
import {
  MetadataJoi,
  RawAsset,
  buildBundlesAsync,
  buildUnsortedUpdateInfoGroupAsync,
  collectAssetsAsync,
  convertAssetToUpdateInfoGroupFormatAsync,
  defaultPublishPlatforms,
  filterCollectedAssetsByRequestedPlatforms,
  filterOutAssetsThatAlreadyExistAsync,
  getAssetHashFromPath,
  getBase64URLEncoding,
  getOriginalPathFromAssetMap,
  getSourceMapExportCommandArgs,
  getStorageKey,
  getStorageKeyForAssetAsync,
  guessContentTypeFromExtension,
  resolveInputDirectoryAsync,
  uploadAssetsAsync,
} from '../publish';

jest.mock('../../uploads');
jest.mock('fs');
jest.mock('../../utils/expoCli', () => ({
  expoCommandAsync: jest.fn(),
  shouldUseVersionedExpoCLI: jest.fn(() => true),
  shouldUseVersionedExpoCLIWithExplicitPlatforms: jest.fn(() => true),
}));

const dummyFileBuffer = Buffer.from('dummy-file');

beforeAll(async () => {
  await fs.mkdir(path.resolve(), { recursive: true });
  await fs.writeFile(path.resolve('md5-hash-of-file'), dummyFileBuffer);
});

afterAll(async () => {
  await fs.remove(path.resolve('md5-hash-of-file'));
});

describe('MetadataJoi', () => {
  it('passes correctly structured metadata', () => {
    const { error } = MetadataJoi.validate({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        android: {
          assets: [{ path: 'assets/3261e570d51777be1e99116562280926', ext: 'png' }],
          bundle: 'bundles/android.js',
        },
        ios: {
          assets: [{ path: 'assets/3261e570d51777be1e99116562280926', ext: 'png' }],
          bundle: 'bundles/ios.js',
        },
      },
    });
    expect(error).toBe(undefined);
  });
  it('fails if a bundle is missing', () => {
    const { error } = MetadataJoi.validate({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        android: {
          assets: [{ path: 'assets/3261e570d51777be1e99116562280926', ext: 'png' }],
          bundle: 'bundles/android.js',
        },
        ios: {
          assets: [{ path: 'assets/3261e570d51777be1e99116562280926', ext: 'png' }],
          bundle: undefined,
        },
      },
    });
    expect(error).toBeDefined();
  });
  it('passes metadata with no assets', () => {
    const { error } = MetadataJoi.validate({
      version: 0,
      bundler: 'metro',
      fileMetadata: {
        android: {
          assets: [],
          bundle: 'bundles/android.js',
        },
        ios: {
          assets: [],
          bundle: 'bundles/ios.js',
        },
      },
    });
    expect(error).toBe(undefined);
  });
});

describe(filterCollectedAssetsByRequestedPlatforms, () => {
  const rawAsset: RawAsset = {
    contentType: 'test',
    path: 'wat',
  };

  it(`returns all`, () => {
    expect(
      filterCollectedAssetsByRequestedPlatforms(
        {
          web: { launchAsset: rawAsset, assets: [] },
          ios: { launchAsset: rawAsset, assets: [] },
          android: { launchAsset: rawAsset, assets: [] },
        },
        RequestedPlatform.All
      )
    ).toEqual({
      ios: { launchAsset: rawAsset, assets: [] },
      android: { launchAsset: rawAsset, assets: [] },
    });
  });
  it(`selects a platform`, () => {
    expect(
      filterCollectedAssetsByRequestedPlatforms(
        {
          web: { launchAsset: rawAsset, assets: [] },
          ios: { launchAsset: rawAsset, assets: [] },
          android: { launchAsset: rawAsset, assets: [] },
        },
        RequestedPlatform.Ios
      )
    ).toEqual({
      ios: { launchAsset: rawAsset, assets: [] },
    });
  });
  it(`asserts selected platform missing`, () => {
    expect(() =>
      filterCollectedAssetsByRequestedPlatforms(
        { web: { launchAsset: rawAsset, assets: [] } },
        RequestedPlatform.Ios
      )
    ).toThrowErrorMatchingInlineSnapshot(
      `"--platform="ios" not found in metadata.json. Available platform(s): web"`
    );
  });
});

describe(guessContentTypeFromExtension, () => {
  it('returns the correct content type for jpg', () => {
    expect(guessContentTypeFromExtension('jpg')).toBe('image/jpeg');
  });
  it('returns application/octet-stream when an ext is not recognized', () => {
    expect(guessContentTypeFromExtension('does-not-exist')).toBe('application/octet-stream');
  });
  it('returns application/octet-stream when an ext is undefined', () => {
    expect(guessContentTypeFromExtension(undefined)).toBe('application/octet-stream');
  });
});

describe(getBase64URLEncoding, () => {
  it('computes the correct encoding', () => {
    expect(getBase64URLEncoding(Buffer.from('test-string'))).toBe('dGVzdC1zdHJpbmc');
  });
});

describe(getStorageKey, () => {
  it('computes the correct key', () => {
    const key = getStorageKey('image/jpeg', 'blibblab');
    expect(key).toBe('j0iiW9hDbR2HKoH1nCxsKRM6QIZVtZ__2ssOiOcxlAs');
  });
  it('uses the null separator to distinguish unequal keys', () => {
    const keyOne = getStorageKey('image/jpeg', 'blibblab');
    const keyTwo = getStorageKey('image', '/jpegblibblab');
    expect(keyOne).not.toBe(keyTwo);
  });
});

describe(getStorageKeyForAssetAsync, () => {
  const pathLocation = uuidv4();
  beforeAll(async () => {
    await fs.writeFile(pathLocation, Buffer.from('I am pretending to be a jpeg'));
  });
  afterAll(async () => {
    await fs.remove(pathLocation);
  });
  it('returns the correct key', async () => {
    const asset = {
      type: 'jpg',
      contentType: 'image/jpeg',
      path: pathLocation,
    };
    expect(await getStorageKeyForAssetAsync(asset)).toBe(
      'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y'
    );
  });
});

describe(convertAssetToUpdateInfoGroupFormatAsync, () => {
  const pathLocation = uuidv4();
  beforeAll(async () => {
    await fs.writeFile(pathLocation, Buffer.from('I am pretending to be a jpeg'));
  });
  afterAll(async () => {
    await fs.remove(pathLocation);
  });
  it('resolves to the correct value', async () => {
    const fileExtension = '.jpg';
    const asset = {
      fileExtension,
      contentType: 'image/jpeg',
      path: pathLocation,
    };
    await expect(convertAssetToUpdateInfoGroupFormatAsync(asset)).resolves.toEqual({
      bundleKey: 'c939e759656f577c058f445bfb19182e',
      fileExtension: '.jpg',
      contentType: 'image/jpeg',
      fileSHA256: 'tzD6J-OQZaHCKnL3GHWV9RbnrpyojnagiOE7r3mSkU4',
      storageKey: 'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y',
    });
  });
});

describe(buildUnsortedUpdateInfoGroupAsync, () => {
  const androidBundlePath = uuidv4();
  const assetPath = uuidv4();

  beforeAll(async () => {
    await fs.writeFile(androidBundlePath, 'I am a js bundle');
    await fs.writeFile(assetPath, 'I am pretending to be a jpeg');
  });
  afterAll(async () => {
    await fs.remove(androidBundlePath);
    await fs.remove(assetPath);
  });

  it('returns the correct value', async () => {
    await expect(
      buildUnsortedUpdateInfoGroupAsync(
        {
          android: {
            launchAsset: {
              fileExtension: '.bundle',
              contentType: 'bundle/javascript',
              path: androidBundlePath,
            },
            assets: [
              {
                fileExtension: '.jpg',
                contentType: 'image/jpeg',
                path: assetPath,
              },
            ],
          },
        },
        {
          slug: 'hello',
          name: 'hello',
        }
      )
    ).resolves.toEqual({
      android: {
        assets: [
          {
            bundleKey: 'c939e759656f577c058f445bfb19182e',
            fileExtension: '.jpg',
            contentType: 'image/jpeg',
            fileSHA256: 'tzD6J-OQZaHCKnL3GHWV9RbnrpyojnagiOE7r3mSkU4',
            storageKey: 'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y',
          },
        ],
        launchAsset: {
          bundleKey: 'ec0dd14670aae108f99a810df9c1482c',
          fileExtension: '.bundle',
          contentType: 'bundle/javascript',
          fileSHA256: 'KEw79FnKTLOyVbRT1SlohSTjPe5e8FpULy2ST-I5BUg',
          storageKey: 'aC9N6RZlcHoIYjIsoJd2KUcigBKy98RHvZacDyPNjCQ',
        },
        extra: {
          expoClient: {
            slug: 'hello',
            name: 'hello',
          },
        },
      },
    });
  });
});

describe(resolveInputDirectoryAsync, () => {
  it('returns the correct distRoot path', async () => {
    const customDirectoryName = path.resolve(uuidv4());
    await fs.mkdir(customDirectoryName, { recursive: true });
    expect(await resolveInputDirectoryAsync(customDirectoryName, { skipBundler: false })).toBe(
      customDirectoryName
    );
  });
  it('throws an error if the path does not exist', async () => {
    const nonExistentPath = path.resolve(uuidv4());
    await expect(
      resolveInputDirectoryAsync(nonExistentPath, { skipBundler: false })
    ).rejects.toThrow(`--input-dir="${nonExistentPath}" not found.`);
  });
  it('throws a more specific error if the path does not exist and the dev opted out of bundling', async () => {
    const nonExistentPath = path.resolve(uuidv4());
    await expect(
      resolveInputDirectoryAsync(nonExistentPath, { skipBundler: true })
    ).rejects.toThrow(
      `--input-dir="${nonExistentPath}" not found. --skip-bundler requires the project to be exported manually before uploading. Ex: npx expo export && eas update --skip-bundler`
    );
  });
});

describe(getAssetHashFromPath, () => {
  it('returns asset hash from path', () => {
    expect(getAssetHashFromPath('assets/5b2a819c71d035ca45d223e4c47ed4f9')).toBe(
      '5b2a819c71d035ca45d223e4c47ed4f9'
    );
  });
  it('returns null for incorrect path', () => {
    expect(getAssetHashFromPath('assets/this/is/not/a/hash.jpg')).toBeNull();
  });
});

describe(getOriginalPathFromAssetMap, () => {
  // Partial assetmap.json, with only fields we need
  const fakeAssetMap = {
    '5b2a819c71d035ca45d223e4c47ed4f9': {
      httpServerLocation: '/assets/src/assets',
      name: 'asset-420',
      type: 'jpg',
    },
  };
  it('returns null path when asset map is null', () => {
    expect(
      getOriginalPathFromAssetMap(null, {
        path: 'assets/5b2a819c71d035ca45d223e4c47ed4f9',
        ext: 'jpg',
      })
    ).toBeNull();
  });
  it('returns null when asset is not found in asset map', () => {
    expect(
      getOriginalPathFromAssetMap(fakeAssetMap, {
        path: 'assets/fb64d3b2fb71b3d739ad5c13a93e12c5',
        ext: 'jpg',
      })
    ).toBeNull();
  });
  it('returns reconstructed original path from existing asset in asset map', () => {
    expect(
      getOriginalPathFromAssetMap(fakeAssetMap, {
        path: 'assets/5b2a819c71d035ca45d223e4c47ed4f9',
        ext: 'jpg',
      })
    ).toBe('/src/assets/asset-420.jpg');
  });
});

describe(collectAssetsAsync, () => {
  it('builds an update info group', async () => {
    const fakeHash = 'hdahukw8adhawi8fawhfa8';
    const bundles = {
      android: 'android-bundle-code',
      ios: 'ios-bundle-code',
      web: 'web-bundle-code',
    };
    const inputDir = path.resolve(uuidv4());

    const userDefinedAssets = [
      {
        fileExtension: '.jpg',
        contentType: 'image/jpeg',
        path: `${inputDir}/assets/${fakeHash}`,
        originalPath: `assets/wat.jpg`,
      },
    ];

    const bundleDir = path.resolve(`${inputDir}/bundles`);
    const assetDir = path.resolve(`${inputDir}/assets`);
    await fs.mkdir(bundleDir, { recursive: true });
    await fs.mkdir(assetDir, { recursive: true });
    for (const platform of defaultPublishPlatforms) {
      await fs.writeFile(path.resolve(inputDir, `bundles/${platform}.js`), bundles[platform]);
    }
    await fs.writeFile(path.resolve(`${inputDir}/assets/${fakeHash}`), dummyFileBuffer);
    await fs.writeFile(
      path.resolve(inputDir, 'metadata.json'),
      JSON.stringify({
        version: 0,
        bundler: 'metro',
        fileMetadata: {
          android: {
            assets: [{ path: `assets/${fakeHash}`, ext: 'jpg' }],
            bundle: 'bundles/android.js',
          },
          ios: {
            assets: [{ path: `assets/${fakeHash}`, ext: 'jpg' }],
            bundle: 'bundles/ios.js',
          },
          web: {
            assets: [{ path: `assets/${fakeHash}`, ext: 'jpg' }],
            bundle: 'bundles/web.js',
          },
        },
      })
    );
    await fs.writeFile(
      path.resolve(inputDir, 'assetmap.json'),
      JSON.stringify({
        [fakeHash]: {
          __packager_asset: true,
          fileSystemLocation: '/Users/blah/temp/assets',
          httpServerLocation: 'assets/assets',
          width: 2339,
          height: 1560,
          scales: [1],
          files: ['/Users/blah/temp/assets/wat.jpg'],
          hash: fakeHash,
          name: 'wat',
          type: 'jpg',
          fileHashes: [fakeHash],
        },
      })
    );

    expect(await collectAssetsAsync(inputDir)).toEqual({
      android: {
        launchAsset: {
          fileExtension: '.js',
          contentType: 'application/javascript',
          path: `${inputDir}/bundles/android.js`,
        },
        assets: userDefinedAssets,
      },
      ios: {
        launchAsset: {
          fileExtension: '.js',
          contentType: 'application/javascript',
          path: `${inputDir}/bundles/ios.js`,
        },
        assets: userDefinedAssets,
      },
      web: {
        launchAsset: {
          fileExtension: '.js',
          contentType: 'application/javascript',
          path: `${inputDir}/bundles/web.js`,
        },
        assets: userDefinedAssets,
      },
    });
  });
});

describe(filterOutAssetsThatAlreadyExistAsync, () => {
  it('gets a missing asset', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      return [
        {
          storageKey: 'blah',
          status: AssetMetadataStatus.DoesNotExist,
          __typename: 'AssetMetadataResult',
        },
      ];
    });

    expect(
      (await filterOutAssetsThatAlreadyExistAsync(graphqlClient, [{ storageKey: 'blah' } as any]))
        .length
    ).toBe(1);
  });
  it('ignores an asset that exists', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      return [
        {
          storageKey: 'blah',
          status: AssetMetadataStatus.Exists,
          __typename: 'AssetMetadataResult',
        },
      ];
    });

    expect(
      (await filterOutAssetsThatAlreadyExistAsync(graphqlClient, [{ storageKey: 'blah' } as any]))
        .length
    ).toBe(0);
  });
});

describe(uploadAssetsAsync, () => {
  const publishBundles = {
    android: {
      code: 'android bundle code',
      assets: [{ files: ['md5-hash-of-file'], type: 'jpg' }],
      map: 'dummy-string',
    },
    ios: {
      code: 'ios bundle code',
      assets: [{ files: ['md5-hash-of-file'], type: 'jpg' }],
      map: 'dummy-string',
    },
  };

  const androidBundlePath = uuidv4();
  const iosBundlePath = uuidv4();
  const dummyFilePath = uuidv4();
  const dummyOriginalFilePath = uuidv4();
  const userDefinedPath = uuidv4();
  const testProjectId = uuidv4();
  const expectedAssetLimit = 1400;

  const userDefinedAsset = {
    type: 'bundle',
    contentType: 'application/octet-stream',
    path: userDefinedPath,
  };

  const assetsForUpdateInfoGroup = {
    android: {
      launchAsset: {
        type: 'bundle',
        contentType: 'application/javascript',
        path: androidBundlePath,
      },
      assets: [
        userDefinedAsset,
        {
          type: 'jpg',
          contentType: 'image/jpeg',
          path: dummyFilePath,
          originalPath: dummyOriginalFilePath,
        },
      ],
    },
    ios: {
      launchAsset: {
        type: 'bundle',
        contentType: 'application/javascript',
        path: androidBundlePath,
      },
      assets: [
        userDefinedAsset,
        {
          type: 'jpg',
          contentType: 'image/jpeg',
          path: dummyFilePath,
          originalPath: dummyOriginalFilePath,
        },
      ],
    },
  };

  beforeAll(async () => {
    await fs.writeFile(androidBundlePath, publishBundles.android.code);
    await fs.writeFile(iosBundlePath, publishBundles.ios.code);
    await fs.writeFile(dummyFilePath, dummyFileBuffer);
    await fs.writeFile(userDefinedPath, 'I am an octet stream');
  });

  afterAll(async () => {
    await fs.remove(androidBundlePath);
    await fs.remove(iosBundlePath);
    await fs.remove(dummyFilePath);
    await fs.remove(userDefinedPath);
  });

  jest
    .spyOn(PublishMutation, 'getUploadURLsAsync')
    .mockImplementation(async (_client, contentTypes) => {
      return { specifications: contentTypes.map(() => '{}') };
    });

  jest
    .spyOn(PublishQuery, 'getAssetLimitPerUpdateGroupAsync')
    .mockImplementation(async () => expectedAssetLimit);

  it('resolves if the assets are already uploaded', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status: AssetMetadataStatus.Exists,
          __typename: 'AssetMetadataResult' as const,
        }));
      });

    mockdate.set(0);
    await expect(
      uploadAssetsAsync(
        graphqlClient,
        assetsForUpdateInfoGroup,
        testProjectId,
        { isCanceledOrFinished: false },
        () => {},
        () => {}
      )
    ).resolves.toEqual({
      assetCount: 6,
      launchAssetCount: 2,
      uniqueAssetCount: 3,
      uniqueUploadedAssetCount: 0,
      uniqueUploadedAssetPaths: [],
      assetLimitPerUpdateGroup: expectedAssetLimit,
    });
  });

  it('resolves if the assets are eventually uploaded', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        const status =
          Date.now() === 0 ? AssetMetadataStatus.DoesNotExist : AssetMetadataStatus.Exists;
        mockdate.set(Date.now() + 1);
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status,
          __typename: 'AssetMetadataResult' as const,
        }));
      });

    mockdate.set(0);
    await expect(
      uploadAssetsAsync(
        graphqlClient,
        assetsForUpdateInfoGroup,
        testProjectId,
        {
          isCanceledOrFinished: false,
        },
        () => {},
        () => {}
      )
    ).resolves.toEqual({
      assetCount: 6,
      launchAssetCount: 2,
      uniqueAssetCount: 3,
      uniqueUploadedAssetCount: 3,
      uniqueUploadedAssetPaths: [dummyOriginalFilePath],
      assetLimitPerUpdateGroup: expectedAssetLimit,
    });
  });

  it('updates spinner text as each asset finalizes', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        const status =
          Date.now() === 0 ? AssetMetadataStatus.DoesNotExist : AssetMetadataStatus.Exists;
        mockdate.set(Date.now() + 1);
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status,
          __typename: 'AssetMetadataResult' as const,
        }));
      });
    const onAssetUploadResultsChangedFn = jest.fn();

    mockdate.set(0);
    await uploadAssetsAsync(
      graphqlClient,
      assetsForUpdateInfoGroup,
      testProjectId,
      { isCanceledOrFinished: false },
      onAssetUploadResultsChangedFn,
      () => {}
    );
    // 1 (all false, before existence check) + 1 (after check) + 1 (after poll resolves all)
    expect(onAssetUploadResultsChangedFn).toHaveBeenCalledTimes(3);
    const firstPayload = onAssetUploadResultsChangedFn.mock.calls[0][0] as { finished: boolean }[];
    expect(firstPayload.every(r => r.finished)).toBe(false);
    const lastPayload = onAssetUploadResultsChangedFn.mock.calls.at(-1)![0] as {
      finished: boolean;
    }[];
    expect(lastPayload.every(r => r.finished)).toBe(true);
  });

  it('re-uploads an asset that remains unfinalized after FINALIZE_POLL_MS', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      // Use a single-asset group to test the re-upload path in isolation
      const singleAssetGroup = {
        android: {
          launchAsset: {
            type: 'bundle',
            contentType: 'application/javascript',
            path: androidBundlePath,
          },
          assets: [],
        },
      };
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      let metadataCallCount = 0;
      jest
        .spyOn(PublishQuery, 'getAssetMetadataAsync')
        .mockImplementation(async (_client, storageKeys) => {
          const callNum = ++metadataCallCount;
          jest.runAllTimers();
          // call 1: initial batch check → missing
          // call 2: first poll (attempt 0) → still missing, advance past deadline
          // call 3: first poll (attempt 1) → exists
          if (callNum === 2) {
            mockdate.set(56_002);
          }
          const status =
            callNum >= 3 ? AssetMetadataStatus.Exists : AssetMetadataStatus.DoesNotExist;
          return storageKeys.map(storageKey => ({
            storageKey,
            status,
            __typename: 'AssetMetadataResult' as const,
          }));
        });
      const getUploadURLsSpy = jest
        .spyOn(PublishMutation, 'getUploadURLsAsync')
        .mockImplementation(async (_client, contentTypes) => ({
          specifications: contentTypes.map(() => '{}'),
        }));
      getUploadURLsSpy.mockClear();

      mockdate.set(0);
      await uploadAssetsAsync(
        graphqlClient,
        singleAssetGroup,
        testProjectId,
        { isCanceledOrFinished: false },
        () => {},
        () => {}
      );

      // 2 URL requests: initial upload (attempt 0) + re-upload (attempt 1)
      expect(getUploadURLsSpy).toHaveBeenCalledTimes(2);
      // 3 metadata checks: initial batch + 1 timed-out poll + 1 success
      expect(metadataCallCount).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('calls notifyProgress incrementally as assets finalize across poll ticks', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      let callCount = 0;
      jest
        .spyOn(PublishQuery, 'getAssetMetadataAsync')
        .mockImplementation(async (_client, storageKeys) => {
          const callNum = ++callCount;
          jest.runAllTimers();
          // call 1: initial check → all missing
          // call 2: poll tick 1 → first asset (index 0) finalizes, others still pending
          // call 3: poll tick 2 → remaining assets finalize
          return storageKeys.map((storageKey, i) => ({
            storageKey,
            status:
              callNum === 1 || (callNum === 2 && i > 0)
                ? AssetMetadataStatus.DoesNotExist
                : AssetMetadataStatus.Exists,
            __typename: 'AssetMetadataResult' as const,
          }));
        });
      const onAssetUploadResultsChangedFn = jest.fn();

      mockdate.set(0);
      await uploadAssetsAsync(
        graphqlClient,
        assetsForUpdateInfoGroup,
        testProjectId,
        { isCanceledOrFinished: false },
        onAssetUploadResultsChangedFn,
        () => {}
      );

      // all-false (before check) + all-false (after check) + partial (tick 1) + all-true (tick 2)
      expect(onAssetUploadResultsChangedFn).toHaveBeenCalledTimes(4);
      const partialResults = onAssetUploadResultsChangedFn.mock.calls[2][0] as {
        finished: boolean;
      }[];
      expect(partialResults.filter(r => r.finished)).toHaveLength(1);
      const finalResults = onAssetUploadResultsChangedFn.mock.calls[3][0] as {
        finished: boolean;
      }[];
      expect(finalResults.every(r => r.finished)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws after all upload attempts are exhausted without finalization', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      const singleAssetGroup = {
        android: {
          launchAsset: {
            type: 'bundle',
            contentType: 'application/javascript',
            path: androidBundlePath,
          },
          assets: [],
        },
      };
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      let callCount = 0;
      jest
        .spyOn(PublishQuery, 'getAssetMetadataAsync')
        .mockImplementation(async (_client, storageKeys) => {
          const callNum = ++callCount;
          jest.runAllTimers();
          // Push time past the 55s deadline on poll calls so each attempt exits after one tick
          if (callNum > 1) {
            mockdate.set(Date.now() + 56_002);
          }
          return storageKeys.map(storageKey => ({
            storageKey,
            status: AssetMetadataStatus.DoesNotExist,
            __typename: 'AssetMetadataResult' as const,
          }));
        });
      const getUploadURLsSpy = jest
        .spyOn(PublishMutation, 'getUploadURLsAsync')
        .mockImplementation(async (_client, contentTypes) => ({
          specifications: contentTypes.map(() => '{}'),
        }));
      getUploadURLsSpy.mockClear();
      const onAssetUploadResultsChangedFn = jest.fn();

      mockdate.set(0);
      let error: Error | undefined;
      try {
        await uploadAssetsAsync(
          graphqlClient,
          singleAssetGroup,
          testProjectId,
          { isCanceledOrFinished: false },
          onAssetUploadResultsChangedFn,
          () => {}
        );
      } catch (e) {
        error = e as Error;
      }

      // Fails loudly rather than publishing an update with unfinalized assets.
      expect(error?.message).toContain('were not processed by the server after 3 attempts');
      // The error names the offending asset so the user knows what to retry.
      expect(error?.message).toContain(androidBundlePath);
      // One URL fetch per attempt across all 3 attempts (MAX_UPLOAD_ATTEMPTS).
      expect(getUploadURLsSpy).toHaveBeenCalledTimes(3);
      // A final progress update reflects the still-unfinalized asset before throwing.
      const lastPayload = onAssetUploadResultsChangedFn.mock.calls.at(-1)![0] as {
        finished: boolean;
      }[];
      expect(lastPayload.every(r => !r.finished)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('signs upload URLs in chunks of 100 for large asset sets', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());

    // 101 unique assets (+1 launch bundle) → 102 unique, chunked into 100 + 2 sign calls.
    const manyAssetPaths: string[] = [];
    const manyAssets: RawAsset[] = [];
    for (let i = 0; i < 101; i++) {
      const assetPath = uuidv4();
      await fs.writeFile(assetPath, Buffer.from(`large-asset-${i}`));
      manyAssetPaths.push(assetPath);
      manyAssets.push({ contentType: 'image/jpeg', path: assetPath });
    }
    const largeAssetGroup = {
      android: {
        launchAsset: {
          type: 'bundle',
          contentType: 'application/javascript',
          path: androidBundlePath,
        },
        assets: manyAssets,
      },
    };

    let metadataCall = 0;
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        const status =
          ++metadataCall === 1 ? AssetMetadataStatus.DoesNotExist : AssetMetadataStatus.Exists;
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status,
          __typename: 'AssetMetadataResult' as const,
        }));
      });
    const getUploadURLsSpy = jest
      .spyOn(PublishMutation, 'getUploadURLsAsync')
      .mockImplementation(async (_client, contentTypes) => ({
        specifications: contentTypes.map(() => '{}'),
      }));
    getUploadURLsSpy.mockClear();

    mockdate.set(0);
    const result = await uploadAssetsAsync(
      graphqlClient,
      largeAssetGroup,
      testProjectId,
      { isCanceledOrFinished: false },
      () => {},
      () => {}
    );

    expect(result.uniqueUploadedAssetCount).toBe(102);
    expect(getUploadURLsSpy).toHaveBeenCalledTimes(2);
    expect(getUploadURLsSpy.mock.calls[0][1]).toHaveLength(100);
    expect(getUploadURLsSpy.mock.calls[1][1]).toHaveLength(2);

    await Promise.all(manyAssetPaths.map(assetPath => fs.remove(assetPath)));
  });

  it('throws if upload URL signing returns fewer URLs than requested', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status: AssetMetadataStatus.DoesNotExist,
          __typename: 'AssetMetadataResult' as const,
        }));
      });
    // Return one fewer specification than requested content types.
    jest
      .spyOn(PublishMutation, 'getUploadURLsAsync')
      .mockImplementation(async (_client, contentTypes) => ({
        specifications: contentTypes.slice(1).map(() => '{}'),
      }));

    mockdate.set(0);
    await expect(
      uploadAssetsAsync(
        graphqlClient,
        assetsForUpdateInfoGroup,
        testProjectId,
        { isCanceledOrFinished: false },
        () => {},
        () => {}
      )
    ).rejects.toThrow('Upload URL signing returned');
  });

  it('re-uploads only the assets that are still missing', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      // Two unique assets: the launch bundle finalizes on the first poll, the image does not,
      // so the second attempt must re-upload only the image.
      const twoAssetGroup = {
        android: {
          launchAsset: {
            type: 'bundle',
            contentType: 'application/javascript',
            path: androidBundlePath,
          },
          assets: [
            {
              type: 'jpg',
              contentType: 'image/jpeg',
              path: dummyFilePath,
              originalPath: dummyOriginalFilePath,
            },
          ],
        },
      };
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      let callNum = 0;
      jest
        .spyOn(PublishQuery, 'getAssetMetadataAsync')
        .mockImplementation(async (_client, storageKeys) => {
          callNum++;
          jest.runAllTimers();
          // call 1: initial check → both missing
          // call 2: attempt 0 poll → launch bundle (index 0) finalizes, image stays missing; time out
          // call 3: attempt 1 poll → image finalizes
          if (callNum === 2) {
            mockdate.set(56_002);
          }
          return storageKeys.map((storageKey, i) => ({
            storageKey,
            status:
              callNum >= 3 || (callNum === 2 && i === 0)
                ? AssetMetadataStatus.Exists
                : AssetMetadataStatus.DoesNotExist,
            __typename: 'AssetMetadataResult' as const,
          }));
        });
      const getUploadURLsSpy = jest
        .spyOn(PublishMutation, 'getUploadURLsAsync')
        .mockImplementation(async (_client, contentTypes) => ({
          specifications: contentTypes.map(() => '{}'),
        }));
      getUploadURLsSpy.mockClear();

      mockdate.set(0);
      const result = await uploadAssetsAsync(
        graphqlClient,
        twoAssetGroup,
        testProjectId,
        { isCanceledOrFinished: false },
        () => {},
        () => {}
      );

      expect(result.uniqueUploadedAssetCount).toBe(2);
      expect(getUploadURLsSpy).toHaveBeenCalledTimes(2);
      // Attempt 0 signs both assets; attempt 1 re-signs only the one that stayed missing.
      expect(getUploadURLsSpy.mock.calls[0][1]).toHaveLength(2);
      expect(getUploadURLsSpy.mock.calls[1][1]).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('calls onAssetUploadBegin on every upload attempt, including re-uploads', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    const uploadMock = jest.mocked(uploadWithPresignedPostWithRetryAsync);
    uploadMock.mockImplementation(async (_path, _presignedPost, onBegin) => {
      onBegin();
      return new Response();
    });
    try {
      const singleAssetGroup = {
        android: {
          launchAsset: {
            type: 'bundle',
            contentType: 'application/javascript',
            path: androidBundlePath,
          },
          assets: [],
        },
      };
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      let callNum = 0;
      jest
        .spyOn(PublishQuery, 'getAssetMetadataAsync')
        .mockImplementation(async (_client, storageKeys) => {
          callNum++;
          jest.runAllTimers();
          if (callNum === 2) {
            mockdate.set(56_002); // time out attempt 0's poll so a re-upload happens
          }
          return storageKeys.map(storageKey => ({
            storageKey,
            status: callNum >= 3 ? AssetMetadataStatus.Exists : AssetMetadataStatus.DoesNotExist,
            __typename: 'AssetMetadataResult' as const,
          }));
        });
      jest
        .spyOn(PublishMutation, 'getUploadURLsAsync')
        .mockImplementation(async (_client, contentTypes) => ({
          specifications: contentTypes.map(() => '{}'),
        }));
      const onAssetUploadBegin = jest.fn();

      mockdate.set(0);
      await uploadAssetsAsync(
        graphqlClient,
        singleAssetGroup,
        testProjectId,
        { isCanceledOrFinished: false },
        () => {},
        onAssetUploadBegin
      );

      // The caller resets its inactivity watchdog on this callback, so re-uploads must fire it too.
      expect(onAssetUploadBegin).toHaveBeenCalledTimes(2);
    } finally {
      uploadMock.mockReset();
      jest.useRealTimers();
    }
  });

  it('throws "Canceled upload" when canceled during the finalize poll', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      const cancelationToken = { isCanceledOrFinished: false };
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      let callNum = 0;
      jest
        .spyOn(PublishQuery, 'getAssetMetadataAsync')
        .mockImplementation(async (_client, storageKeys) => {
          callNum++;
          jest.runAllTimers();
          // Cancel during the first poll tick (call 2), after the initial check and upload.
          if (callNum === 2) {
            cancelationToken.isCanceledOrFinished = true;
          }
          return storageKeys.map(storageKey => ({
            storageKey,
            status: AssetMetadataStatus.DoesNotExist,
            __typename: 'AssetMetadataResult' as const,
          }));
        });
      jest
        .spyOn(PublishMutation, 'getUploadURLsAsync')
        .mockImplementation(async (_client, contentTypes) => ({
          specifications: contentTypes.map(() => '{}'),
        }));

      mockdate.set(0);
      await expect(
        uploadAssetsAsync(
          graphqlClient,
          assetsForUpdateInfoGroup,
          testProjectId,
          cancelationToken,
          () => {},
          () => {}
        )
      ).rejects.toThrow('Canceled upload');
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws "Canceled upload" when canceled during upload signing', async () => {
    const cancelationToken = { isCanceledOrFinished: false };
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status: AssetMetadataStatus.DoesNotExist,
          __typename: 'AssetMetadataResult' as const,
        }));
      });
    jest
      .spyOn(PublishMutation, 'getUploadURLsAsync')
      .mockImplementation(async (_client, contentTypes) => ({
        specifications: contentTypes.map(() => '{}'),
      }));
    // Cancel on the second progress callback (fired right after the initial existence check
    // passes, before uploading begins) so the cancellation is caught inside the signing loop.
    let progressCallCount = 0;
    const onAssetUploadResultsChanged = jest.fn(() => {
      if (++progressCallCount === 2) {
        cancelationToken.isCanceledOrFinished = true;
      }
    });

    mockdate.set(0);
    await expect(
      uploadAssetsAsync(
        graphqlClient,
        assetsForUpdateInfoGroup,
        testProjectId,
        cancelationToken,
        onAssetUploadResultsChanged,
        () => {}
      )
    ).rejects.toThrow('Canceled upload');
  });

  it('resolves with zero counts and signs no URLs for an empty asset group', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest
      .spyOn(PublishQuery, 'getAssetMetadataAsync')
      .mockImplementation(async (_client, storageKeys) => {
        jest.runAllTimers();
        return storageKeys.map(storageKey => ({
          storageKey,
          status: AssetMetadataStatus.Exists,
          __typename: 'AssetMetadataResult' as const,
        }));
      });
    const getUploadURLsSpy = jest
      .spyOn(PublishMutation, 'getUploadURLsAsync')
      .mockImplementation(async (_client, contentTypes) => ({
        specifications: contentTypes.map(() => '{}'),
      }));
    getUploadURLsSpy.mockClear();

    mockdate.set(0);
    const result = await uploadAssetsAsync(
      graphqlClient,
      {},
      testProjectId,
      { isCanceledOrFinished: false },
      () => {},
      () => {}
    );

    expect(result).toMatchObject({
      assetCount: 0,
      launchAssetCount: 0,
      uniqueAssetCount: 0,
      uniqueUploadedAssetCount: 0,
      uniqueUploadedAssetPaths: [],
    });
    expect(getUploadURLsSpy).not.toHaveBeenCalled();
  });
});

describe(getSourceMapExportCommandArgs, () => {
  it('returns --dump-sourcemap when sourceMaps is undefined, empty array when "false"', () => {
    expect(getSourceMapExportCommandArgs({ sourceMaps: undefined, sdkVersion: '50.0.0' })).toEqual([
      '--dump-sourcemap',
    ]);
    expect(getSourceMapExportCommandArgs({ sourceMaps: 'false', sdkVersion: '55.0.0' })).toEqual(
      []
    );
  });

  it('returns --source-maps with value only for SDK >= 55', () => {
    // SDK < 55: no value
    expect(getSourceMapExportCommandArgs({ sourceMaps: 'inline', sdkVersion: '50.0.0' })).toEqual([
      '--source-maps',
    ]);
    // SDK >= 55: includes value
    expect(getSourceMapExportCommandArgs({ sourceMaps: 'inline', sdkVersion: '55.0.0' })).toEqual([
      '--source-maps',
      'inline',
    ]);
    // "true" never includes a value
    expect(getSourceMapExportCommandArgs({ sourceMaps: 'true', sdkVersion: '55.0.0' })).toEqual([
      '--source-maps',
    ]);
  });
});

describe(buildBundlesAsync, () => {
  const projectDir = '/test-project';
  const inputDir = 'dist';

  beforeEach(async () => {
    jest.mocked(expoCommandAsync).mockClear();
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' })
    );
  });

  afterEach(async () => {
    await fs.remove(projectDir);
  });

  it('uses --source-maps instead of --dump-sourcemap when provided', async () => {
    // SDK < 55: --source-maps is a boolean flag, value not supported
    // When sourceMaps is 'inline' but SDK < 55, pass --source-maps without the value
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '50.0.0' },
      platformFlag: 'all',
      sourceMaps: 'inline',
    });
    let args = jest.mocked(expoCommandAsync).mock.calls[0][1];
    expect(args).toContain('--source-maps');
    expect(args).not.toContain('inline');
    expect(args).not.toContain('--dump-sourcemap');

    // SDK >= 55: --source-maps supports a value (e.g., 'inline')
    jest.mocked(expoCommandAsync).mockClear();
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '55.0.0' },
      platformFlag: 'all',
      sourceMaps: 'inline',
    });
    expect(expoCommandAsync).toHaveBeenCalledWith(
      projectDir,
      expect.arrayContaining(['--source-maps', 'inline']),
      expect.any(Object)
    );
    expect(jest.mocked(expoCommandAsync).mock.calls[0][1]).not.toContain('--dump-sourcemap');

    // When sourceMaps is 'true', pass --source-maps without a value (regardless of SDK version)
    jest.mocked(expoCommandAsync).mockClear();
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '55.0.0' },
      platformFlag: 'all',
      sourceMaps: 'true',
    });
    args = jest.mocked(expoCommandAsync).mock.calls[0][1];
    expect(args).toContain('--source-maps');
    expect(args).not.toContain('true');
    expect(args).not.toContain('--dump-sourcemap');

    // When sourceMaps is "false", don't pass any source map flags
    jest.mocked(expoCommandAsync).mockClear();
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '50.0.0' },
      platformFlag: 'all',
      sourceMaps: 'false',
    });
    expect(jest.mocked(expoCommandAsync).mock.calls[0][1]).not.toContain('--source-maps');
    expect(jest.mocked(expoCommandAsync).mock.calls[0][1]).not.toContain('--dump-sourcemap');

    // When sourceMaps is undefined, fall back to --dump-sourcemap
    jest.mocked(expoCommandAsync).mockClear();
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '50.0.0' },
      platformFlag: 'all',
    });
    expect(jest.mocked(expoCommandAsync).mock.calls[0][1]).not.toContain('--source-maps');
    expect(jest.mocked(expoCommandAsync).mock.calls[0][1]).toContain('--dump-sourcemap');
  });

  it('passes --no-bytecode only when true', async () => {
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '50.0.0' },
      platformFlag: 'all',
      noBytecode: true,
    });
    expect(expoCommandAsync).toHaveBeenCalledWith(
      projectDir,
      expect.arrayContaining(['--no-bytecode']),
      expect.any(Object)
    );

    jest.mocked(expoCommandAsync).mockClear();
    await buildBundlesAsync({
      projectDir,
      inputDir,
      exp: { sdkVersion: '50.0.0' },
      platformFlag: 'all',
      noBytecode: false,
    });
    expect(jest.mocked(expoCommandAsync).mock.calls[0][1]).not.toContain('--no-bytecode');
  });
});
