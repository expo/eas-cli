import fs from 'fs';
import mockdate from 'mockdate';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
  getDistRoot,
  getStorageKey,
  getStorageKeyForAsset,
  guessContentTypeFromExtension,
  uploadAssetsAsync,
} from '../publish';

jest.mock('../../uploads');
jest.mock('fs');
process.cwd = jest.fn().mockImplementation(() => '/');

const dummyFileBuffer = Buffer.from('dummy-file');
fs.writeFileSync('md5-hash-of-file', dummyFileBuffer);

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

describe(getDistRoot, () => {
  it('returns the correct distRoot path', () => {
    const customDirectoryName = uuidv4();
    fs.mkdirSync(customDirectoryName);
    expect(getDistRoot(customDirectoryName)).toBe(path.join(process.cwd(), customDirectoryName));
  });
  it('throws an error if the path does not exist', () => {
    const nonExistentPath = uuidv4();
    expect(() => {
      getDistRoot(nonExistentPath);
    }).toThrow(`/${nonExistentPath} does not exist. Please create it with your desired bundler.`);
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

    fs.mkdirSync(inputDir);
    fs.mkdirSync(`${inputDir}/bundles`);
    fs.mkdirSync(`${inputDir}/assets`);
    Platforms.forEach(platform => {
      fs.writeFileSync(`${inputDir}/${platform}-index.json`, JSON.stringify(fakeJson));
      fs.writeFileSync(`${inputDir}/bundles/${platform}-randomHash.js`, bundles[platform]);
    });
    fs.writeFileSync(`${inputDir}/assets/${fakeHash}`, userDefinedAssets[0].buffer);

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
      return [{ storageKey: 'blah', status: 'DOES_NOT_EXIST', __typename: 'dummy' }];
    });

    expect(
      await (await filterOutAssetsThatAlreadyExistAsync([{ storageKey: 'blah' } as any])).length
    ).toBe(1);
  });
  it('ignores an asset that exists', async () => {
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      return [{ storageKey: 'blah', status: 'EXISTS', __typename: 'dummy' }];
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
      const status = 'DOES_NOT_EXIST';
      mockdate.set(Date.now() + TIMEOUT_LIMIT + 1);
      return [
        {
          storageKey: 'qbgckgkgfdjnNuf9dQd7FDTWUmlEEzg7l1m1sKzQaq0',
          status,
          __typename: 'dummy',
        }, // userDefinedAsset
        {
          storageKey: 'bbjgXFSIXtjviGwkaPFY0HG4dVVIGiXHAboRFQEqVa4',
          status,
          __typename: 'dummy',
        }, // android.code
        {
          storageKey: 'dP-nC8EJXKz42XKh_Rc9tYxiGAT-ilpkRltEi6HIKeQ',
          status,
          __typename: 'dummy',
        }, // ios.code
      ];
    });

    mockdate.set(0);
    await expect(uploadAssetsAsync(assetsForUpdateInfoGroup)).rejects.toThrow(
      'Failed to upload all assets. Please try again.'
    );
  });
  it('resolves if the assets are already uploaded', async () => {
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status = 'EXISTS';
      return [
        {
          storageKey: 'qbgckgkgfdjnNuf9dQd7FDTWUmlEEzg7l1m1sKzQaq0',
          status,
          __typename: 'dummy',
        }, // userDefinedAsset
        {
          storageKey: 'bbjgXFSIXtjviGwkaPFY0HG4dVVIGiXHAboRFQEqVa4',
          status,
          __typename: 'dummy',
        }, // android.code
        {
          storageKey: 'dP-nC8EJXKz42XKh_Rc9tYxiGAT-ilpkRltEi6HIKeQ',
          status,
          __typename: 'dummy',
        }, // ios.code
      ];
    });

    mockdate.set(0);
    await expect(uploadAssetsAsync(assetsForUpdateInfoGroup)).resolves.toBe(undefined);
  });
  it('resolves if the assets are eventually uploaded', async () => {
    jest.spyOn(PublishQuery, 'getAssetMetadataAsync').mockImplementation(async () => {
      const status = Date.now() === 0 ? 'DOES_NOT_EXIST' : 'EXISTS';
      mockdate.set(Date.now() + 1);
      return [
        {
          storageKey: 'qbgckgkgfdjnNuf9dQd7FDTWUmlEEzg7l1m1sKzQaq0',
          status,
          __typename: 'dummy',
        }, // userDefinedAsset
        {
          storageKey: 'bbjgXFSIXtjviGwkaPFY0HG4dVVIGiXHAboRFQEqVa4',
          status,
          __typename: 'dummy',
        }, // android.code
        {
          storageKey: 'dP-nC8EJXKz42XKh_Rc9tYxiGAT-ilpkRltEi6HIKeQ',
          status,
          __typename: 'dummy',
        }, // ios.code
      ];
    });

    mockdate.set(0);
    await expect(uploadAssetsAsync(assetsForUpdateInfoGroup)).resolves.toBe(undefined);
  });
});
