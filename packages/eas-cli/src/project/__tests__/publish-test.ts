import fs from 'fs-extra';
import mockdate from 'mockdate';
import path from 'path';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AssetMetadataStatus } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { PublishQuery } from '../../graphql/queries/PublishQuery';
import { RequestedPlatform } from '../../platform';
import {
  MetadataJoi,
  RawAsset,
  buildUnsortedUpdateInfoGroupAsync,
  collectAssetsAsync,
  convertAssetToUpdateInfoGroupFormatAsync,
  defaultPublishPlatforms,
  filterCollectedAssetsByRequestedPlatforms,
  filterOutAssetsThatAlreadyExistAsync,
  getAssetHashFromPath,
  getBase64URLEncoding,
  getOriginalPathFromAssetMap,
  getStorageKey,
  getStorageKeyForAssetAsync,
  guessContentTypeFromExtension,
  resolveInputDirectoryAsync,
  uploadAssetsAsync,
} from '../publish';

jest.mock('../../uploads');
jest.mock('fs');

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
          fileExtension: '.bundle',
          contentType: 'application/javascript',
          path: `${inputDir}/bundles/android.js`,
        },
        assets: userDefinedAssets,
      },
      ios: {
        launchAsset: {
          fileExtension: '.bundle',
          contentType: 'application/javascript',
          path: `${inputDir}/bundles/ios.js`,
        },
        assets: userDefinedAssets,
      },
      web: {
        launchAsset: {
          fileExtension: '.bundle',
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

  jest.spyOn(PublishMutation, 'getUploadURLsAsync').mockImplementation(async () => {
    return { specifications: ['{}', '{}', '{}'] };
  });

  jest
    .spyOn(PublishQuery, 'getAssetLimitPerUpdateGroupAsync')
    .mockImplementation(async () => expectedAssetLimit);

  it('resolves if the assets are already uploaded', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status = AssetMetadataStatus.Exists;
      jest.runAllTimers();
      return [
        {
          storageKey: 'qbgckgkgfdjnNuf9dQd7FDTWUmlEEzg7l1m1sKzQaq0',
          status,
          __typename: 'AssetMetadataResult',
        }, // userDefinedAsset
        {
          storageKey: 'bbjgXFSIXtjviGwkaPFY0HG4dVVIGiXHAboRFQEqVa4',
          status,
          __typename: 'AssetMetadataResult',
        }, // android.code
        {
          storageKey: 'dP-nC8EJXKz42XKh_Rc9tYxiGAT-ilpkRltEi6HIKeQ',
          status,
          __typename: 'AssetMetadataResult',
        }, // ios.code
      ];
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
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status =
        Date.now() === 0 ? AssetMetadataStatus.DoesNotExist : AssetMetadataStatus.Exists;
      mockdate.set(Date.now() + 1);
      jest.runAllTimers();
      return [
        {
          storageKey: 'qbgckgkgfdjnNuf9dQd7FDTWUmlEEzg7l1m1sKzQaq0',
          status,
          __typename: 'AssetMetadataResult',
        }, // userDefinedAsset
        {
          storageKey: 'bbjgXFSIXtjviGwkaPFY0HG4dVVIGiXHAboRFQEqVa4',
          status,
          __typename: 'AssetMetadataResult',
        }, // android.code
        {
          storageKey: 'dP-nC8EJXKz42XKh_Rc9tYxiGAT-ilpkRltEi6HIKeQ',
          status,
          __typename: 'AssetMetadataResult',
        }, // ios.code
      ];
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
      uniqueUploadedAssetCount: 2,
      uniqueUploadedAssetPaths: [],
      assetLimitPerUpdateGroup: expectedAssetLimit,
    });
  });

  it('updates spinner text throughout execution', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status =
        Date.now() === 0 ? AssetMetadataStatus.DoesNotExist : AssetMetadataStatus.Exists;
      mockdate.set(Date.now() + 1);
      jest.runAllTimers();
      return [
        {
          storageKey: 'qbgckgkgfdjnNuf9dQd7FDTWUmlEEzg7l1m1sKzQaq0',
          status,
          __typename: 'AssetMetadataResult',
        }, // userDefinedAsset
        {
          storageKey: 'bbjgXFSIXtjviGwkaPFY0HG4dVVIGiXHAboRFQEqVa4',
          status,
          __typename: 'AssetMetadataResult',
        }, // android.code
        {
          storageKey: 'dP-nC8EJXKz42XKh_Rc9tYxiGAT-ilpkRltEi6HIKeQ',
          status,
          __typename: 'AssetMetadataResult',
        }, // ios.code
      ];
    });
    const onAssetUploadResultsChangedFn = jest.fn(_assetUploadResults => {});

    mockdate.set(0);
    await uploadAssetsAsync(
      graphqlClient,
      assetsForUpdateInfoGroup,
      testProjectId,
      { isCanceledOrFinished: false },
      onAssetUploadResultsChangedFn,
      () => {}
    );
    expect(onAssetUploadResultsChangedFn).toHaveBeenCalledTimes(3);
  });
});
