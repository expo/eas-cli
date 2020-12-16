import fs from 'fs';
import mockdate from 'mockdate';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { AssetMetadataStatus } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { PublishQuery } from '../../graphql/queries/PublishQuery';
import {
  Platforms,
  TIMEOUT_LIMIT,
  buildUpdateInfoGroup,
  collectAssets,
  convertAssetToUpdateInfoGroupFormat,
  filterOutAssetsThatAlreadyExistAsync,
  getBase64URLEncoding,
  getStorageKey,
  getStorageKeyForAsset,
  guessContentTypeFromExtension,
  resolveInputDirectory,
  uploadAssetsAsync,
} from '../publish';

jest.mock('../../uploads');
jest.mock('fs');

const dummyFileBuffer = Buffer.from('dummy-file');
fs.mkdirSync(path.resolve(), { recursive: true });
fs.writeFileSync(path.resolve('md5-hash-of-file'), dummyFileBuffer);

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

describe(getStorageKeyForAsset, () => {
  it('returns the correct key', () => {
    const asset = {
      type: 'jpg',
      contentType: 'image/jpeg',
      buffer: Buffer.from('I am pretending to be a jpeg'),
    };
    expect(getStorageKeyForAsset(asset)).toBe('fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y');
  });
});

describe(convertAssetToUpdateInfoGroupFormat, () => {
  const type = 'jpg';
  const asset = {
    type,
    contentType: 'image/jpeg',
    buffer: Buffer.from('I am pretending to be a jpeg'),
  };
  expect(convertAssetToUpdateInfoGroupFormat(asset)).toEqual({
    bundleKey: `c939e759656f577c058f445bfb19182e.${type}`,
    contentType: 'image/jpeg',
    fileHash: 'tzD6J-OQZaHCKnL3GHWV9RbnrpyojnagiOE7r3mSkU4',
    storageBucket: 'update-assets-testing',
    storageKey: 'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y',
  });
});

describe(buildUpdateInfoGroup, () => {
  expect(
    buildUpdateInfoGroup({
      android: {
        launchAsset: {
          type: 'bundle',
          contentType: 'bundle/javascript',
          buffer: Buffer.from('I am a js bundle'),
        },
        assets: [
          {
            type: 'jpg',
            contentType: 'image/jpeg',
            buffer: Buffer.from('I am pretending to be a jpeg'),
          },
        ],
      },
    })
  ).toEqual({
    android: {
      assets: [
        {
          bundleKey: 'c939e759656f577c058f445bfb19182e.jpg',
          contentType: 'image/jpeg',
          fileHash: 'tzD6J-OQZaHCKnL3GHWV9RbnrpyojnagiOE7r3mSkU4',
          storageBucket: 'update-assets-testing',
          storageKey: 'fo8Y08LktVk6qLtGbn8GRWpOUyD13ABMUnbtRCN1L7Y',
        },
      ],

      launchAsset: {
        bundleKey: 'ec0dd14670aae108f99a810df9c1482c.bundle',
        contentType: 'bundle/javascript',
        fileHash: 'KEw79FnKTLOyVbRT1SlohSTjPe5e8FpULy2ST-I5BUg',
        storageBucket: 'update-assets-testing',
        storageKey: 'aC9N6RZlcHoIYjIsoJd2KUcigBKy98RHvZacDyPNjCQ',
      },
    },
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
    }).toThrow(`${nonExistentPath} does not exist. Please create it with your desired bundler.`);
  });
});

describe(collectAssets, () => {
  it('builds an update info group', () => {
    const fakeHash = 'md5-hash-of-jpg';
    const fakeJson = { bundledAssets: [`asset_${fakeHash}.jpg`] };
    const bundles = { android: 'android-bundle-code', ios: 'ios-bundle-code' };
    const userDefinedAssets = [
      {
        type: 'jpg',
        contentType: 'image/jpeg',
        buffer: dummyFileBuffer,
      },
    ];
    const inputDir = 'dist';

    const bundleDir = path.resolve(`${inputDir}/bundles`);
    const assetDir = path.resolve(`${inputDir}/assets`);
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.mkdirSync(assetDir, { recursive: true });
    Platforms.forEach(platform => {
      fs.writeFileSync(
        path.resolve(`${inputDir}/${platform}-index.json`),
        JSON.stringify(fakeJson)
      );
      fs.writeFileSync(
        path.resolve(`${inputDir}/bundles/${platform}-randomHash.js`),
        bundles[platform]
      );
    });
    fs.writeFileSync(path.resolve(`${inputDir}/assets/${fakeHash}`), userDefinedAssets[0].buffer);

    expect(collectAssets(inputDir)).toEqual({
      android: {
        launchAsset: {
          type: 'bundle',
          contentType: 'application/javascript',
          buffer: Buffer.from(bundles['android']),
        },
        assets: userDefinedAssets,
      },
      ios: {
        launchAsset: {
          type: 'bundle',
          contentType: 'application/javascript',
          buffer: Buffer.from(bundles['ios']),
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
      await (await filterOutAssetsThatAlreadyExistAsync([{ storageKey: 'blah' } as any])).length
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
      await (await filterOutAssetsThatAlreadyExistAsync([{ storageKey: 'blah' } as any])).length
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
  const userDefinedAsset = {
    type: 'bundle',
    contentType: 'application/octet-stream',
    buffer: Buffer.from('I am an octet stream'),
  };
  const assetsForUpdateInfoGroup = {
    android: {
      launchAsset: {
        type: 'bundle',
        contentType: 'application/javascript',
        buffer: Buffer.from(publishBundles.android.code),
      },
      assets: [
        userDefinedAsset,
        { type: 'jpg', contentType: 'image/jpeg', buffer: dummyFileBuffer },
      ],
    },
    ios: {
      launchAsset: {
        type: 'bundle',
        contentType: 'application/javascript',
        buffer: Buffer.from(publishBundles.ios.code),
      },
      assets: [
        userDefinedAsset,
        { type: 'jpg', contentType: 'image/jpeg', buffer: dummyFileBuffer },
      ],
    },
  };
  jest.spyOn(PublishMutation, 'getUploadURLsAsync').mockImplementation(async () => {
    return { specifications: ['{}', '{}', '{}'] };
  });

  it('throws an error if the upload exceeds TIMEOUT_LIMIT', async () => {
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status = AssetMetadataStatus.DoesNotExist;
      mockdate.set(Date.now() + TIMEOUT_LIMIT + 1);
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
