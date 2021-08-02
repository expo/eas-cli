import fs from 'fs';
import mockdate from 'mockdate';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { defaultPublishPlatforms } from '../../commands/branch/publish';
import { AssetMetadataStatus } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { PublishQuery } from '../../graphql/queries/PublishQuery';
import {
  MetadataJoi,
  TIMEOUT_LIMIT,
  buildUpdateInfoGroupAsync,
  collectAssets,
  convertAssetToUpdateInfoGroupFormatAsync,
  filterOutAssetsThatAlreadyExistAsync,
  getBase64URLEncoding,
  getStorageKey,
  getStorageKeyForAssetAsync,
  guessContentTypeFromExtension,
  resolveInputDirectory,
  uploadAssetsAsync,
} from '../publish';

jest.mock('../../uploads');
jest.mock('fs');

const dummyFileBuffer = Buffer.from('dummy-file');
fs.mkdirSync(path.resolve(), { recursive: true });
fs.writeFileSync(path.resolve('md5-hash-of-file'), dummyFileBuffer);

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
  fs.writeFileSync(pathLocation, Buffer.from('I am pretending to be a jpeg'));
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
  it('resolves to the correct value', async () => {
    const path = uuidv4();
    fs.writeFileSync(path, 'I am pretending to be a jpeg');
    const type = 'jpg';
    const asset = {
      type,
      contentType: 'image/jpeg',
      path,
    };
    await expect(convertAssetToUpdateInfoGroupFormatAsync(asset)).resolves.toEqual({
      bundleKey: 'c939e759656f577c058f445bfb19182e',
      contentType: 'image/jpeg',
      fileSHA256: 'tzD6J-OQZaHCKnL3GHWV9RbnrpyojnagiOE7r3mSkU4',
      storageKey: 'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y',
    });
  });
});

describe(buildUpdateInfoGroupAsync, () => {
  const androidBundlePath = uuidv4();
  const assetPath = uuidv4();
  fs.writeFileSync(androidBundlePath, 'I am a js bundle');
  fs.writeFileSync(assetPath, 'I am pretending to be a jpeg');

  it('returns the correct value', async () => {
    await expect(
      buildUpdateInfoGroupAsync(
        {
          android: {
            launchAsset: {
              type: 'bundle',
              contentType: 'bundle/javascript',
              path: androidBundlePath,
            },
            assets: [
              {
                type: 'jpg',
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
            contentType: 'image/jpeg',
            fileSHA256: 'tzD6J-OQZaHCKnL3GHWV9RbnrpyojnagiOE7r3mSkU4',
            storageKey: 'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y',
          },
        ],
        launchAsset: {
          bundleKey: 'ec0dd14670aae108f99a810df9c1482c',
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

describe(resolveInputDirectory, () => {
  it('returns the correct distRoot path', () => {
    const customDirectoryName = path.resolve(uuidv4());
    fs.mkdirSync(customDirectoryName, { recursive: true });
    expect(resolveInputDirectory(customDirectoryName)).toBe(customDirectoryName);
  });
  it('throws an error if the path does not exist', () => {
    const nonExistentPath = path.resolve(uuidv4());
    expect(() => {
      resolveInputDirectory(nonExistentPath);
    }).toThrow(`The input directory "${nonExistentPath}" does not exist.
    You can allow us to build it for you by not setting the --skip-bundler flag.
    If you chose to build it yourself you'll need to run a command to build the JS
    bundle first.
    You can use '--input-dir' to specify a different input directory.`);
  });
});

describe(collectAssets, () => {
  it('builds an update info group', () => {
    const fakeHash = 'md5-hash-of-jpg';
    const bundles = { android: 'android-bundle-code', ios: 'ios-bundle-code' };
    const inputDir = uuidv4();

    const userDefinedAssets = [
      {
        type: 'jpg',
        contentType: 'image/jpeg',
        path: path.resolve(`${inputDir}/assets/${fakeHash}`),
      },
    ];

    const bundleDir = path.resolve(`${inputDir}/bundles`);
    const assetDir = path.resolve(`${inputDir}/assets`);
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.mkdirSync(assetDir, { recursive: true });
    defaultPublishPlatforms.forEach(platform => {
      fs.writeFileSync(path.resolve(inputDir, `bundles/${platform}.js`), bundles[platform]);
    });
    fs.writeFileSync(path.resolve(`${inputDir}/assets/${fakeHash}`), dummyFileBuffer);
    fs.writeFileSync(
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
        },
      })
    );

    expect(collectAssets({ inputDir, platforms: defaultPublishPlatforms })).toEqual({
      android: {
        launchAsset: {
          type: 'bundle',
          contentType: 'application/javascript',
          path: path.resolve(`${inputDir}/bundles/android.js`),
        },
        assets: userDefinedAssets,
      },
      ios: {
        launchAsset: {
          type: 'bundle',
          contentType: 'application/javascript',
          path: path.resolve(`${inputDir}/bundles/ios.js`),
        },
        assets: userDefinedAssets,
      },
    });

    expect(collectAssets({ inputDir, platforms: ['ios'] })).toEqual({
      ios: {
        launchAsset: {
          type: 'bundle',
          contentType: 'application/javascript',
          path: path.resolve(`${inputDir}/bundles/ios.js`),
        },
        assets: userDefinedAssets,
      },
    });
  });
});

describe(filterOutAssetsThatAlreadyExistAsync, () => {
  it('gets a missing asset', async () => {
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
      await (
        await filterOutAssetsThatAlreadyExistAsync([{ storageKey: 'blah' } as any])
      ).length
    ).toBe(1);
  });
  it('ignores an asset that exists', async () => {
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
      await (
        await filterOutAssetsThatAlreadyExistAsync([{ storageKey: 'blah' } as any])
      ).length
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
  const userDefinedPath = uuidv4();
  fs.writeFileSync(androidBundlePath, publishBundles.android.code);
  fs.writeFileSync(iosBundlePath, publishBundles.ios.code);
  fs.writeFileSync(dummyFilePath, dummyFileBuffer);
  fs.writeFileSync(userDefinedPath, 'I am an octet stream');

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
      assets: [userDefinedAsset, { type: 'jpg', contentType: 'image/jpeg', path: dummyFilePath }],
    },
    ios: {
      launchAsset: {
        type: 'bundle',
        contentType: 'application/javascript',
        path: androidBundlePath,
      },
      assets: [userDefinedAsset, { type: 'jpg', contentType: 'image/jpeg', path: dummyFilePath }],
    },
  };
  jest.spyOn(PublishMutation, 'getUploadURLsAsync').mockImplementation(async () => {
    return { specifications: ['{}', '{}', '{}'] };
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });
  it('throws an error if the upload exceeds TIMEOUT_LIMIT', async () => {
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status = AssetMetadataStatus.DoesNotExist;
      mockdate.set(Date.now() + TIMEOUT_LIMIT + 1);
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
    await expect(uploadAssetsAsync(assetsForUpdateInfoGroup)).rejects.toThrow(
      'Asset upload timed out. Please try again.'
    );
  });
  it('resolves if the assets are already uploaded', async () => {
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
    await expect(uploadAssetsAsync(assetsForUpdateInfoGroup)).resolves.toBe(undefined);
  });
  it('resolves if the assets are eventually uploaded', async () => {
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
    await expect(uploadAssetsAsync(assetsForUpdateInfoGroup)).resolves.toBe(undefined);
  });
});
