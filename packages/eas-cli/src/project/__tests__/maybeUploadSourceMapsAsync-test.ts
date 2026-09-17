import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { UPLOAD_SESSION_TYPE_EAS_UPDATE_SOURCE_MAPS } from '../../graphql/sourceMapShim';
import { uploadFileAtPathToGCSAsync } from '../../uploads';
import {
  MAX_SOURCE_MAP_SIZE_BYTES,
  isSourceMapPlatform,
  maybeUploadSourceMapsAsync,
  resolveSourceMapPathsAsync,
  stripSourcesContentAsync,
} from '../maybeUploadSourceMapsAsync';

jest.mock('fs');
jest.mock('../../uploads');
jest.mock('../../log');

const distRoot = '/dist';
const androidBundle = '_expo/static/js/android/entry-abc.hbc';
const iosBundle = '_expo/static/js/ios/entry-def.hbc';

function sourceMap(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 3,
    sources: ['index.js'],
    sourcesContent: ['console.log("hello");'],
    names: [],
    mappings: 'AAAA',
    ...extra,
  });
}

function writeExport({
  platforms = ['android', 'ios'],
  maps = true,
}: { platforms?: ('android' | 'ios')[]; maps?: boolean } = {}): void {
  const bundles: Record<string, string> = { android: androidBundle, ios: iosBundle };
  const files: Record<string, string> = {
    [path.join(distRoot, 'metadata.json')]: JSON.stringify({
      version: 0,
      bundler: 'metro',
      fileMetadata: Object.fromEntries(
        platforms.map(platform => [platform, { assets: [], bundle: bundles[platform] }])
      ),
    }),
  };
  for (const platform of platforms) {
    files[path.join(distRoot, bundles[platform])] = 'bundle';
    if (maps) {
      files[path.join(distRoot, `${bundles[platform]}.map`)] = sourceMap();
    }
  }
  vol.fromJSON(files);
}

describe(isSourceMapPlatform, () => {
  it.each(['android', 'ios'])('accepts %s', platform => {
    expect(isSourceMapPlatform(platform)).toBe(true);
  });

  it.each(['web', 'windows', ''])('rejects %s', platform => {
    expect(isSourceMapPlatform(platform)).toBe(false);
  });
});

describe(resolveSourceMapPathsAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('resolves <bundle>.map for both platforms', async () => {
    writeExport();

    await expect(resolveSourceMapPathsAsync(distRoot)).resolves.toEqual({
      android: path.join(distRoot, `${androidBundle}.map`),
      ios: path.join(distRoot, `${iosBundle}.map`),
    });
  });

  it('falls back to a single .map beside the bundle', async () => {
    writeExport({ maps: false });
    vol.writeFileSync(path.join(distRoot, '_expo/static/js/ios/some-other-name.map'), sourceMap());

    const paths = await resolveSourceMapPathsAsync(distRoot);
    expect(paths.ios).toBe(path.join(distRoot, '_expo/static/js/ios/some-other-name.map'));
    expect(paths.android).toBeUndefined();
  });

  it('skips a platform when the fallback is ambiguous', async () => {
    writeExport({ maps: false });
    vol.writeFileSync(path.join(distRoot, '_expo/static/js/ios/one.map'), sourceMap());
    vol.writeFileSync(path.join(distRoot, '_expo/static/js/ios/two.map'), sourceMap());

    await expect(resolveSourceMapPathsAsync(distRoot)).resolves.toEqual({});
  });

  it('omits a platform that is absent from metadata.json', async () => {
    writeExport({ platforms: ['android'] });

    const paths = await resolveSourceMapPathsAsync(distRoot);
    expect(paths.android).toBe(path.join(distRoot, `${androidBundle}.map`));
    expect(paths.ios).toBeUndefined();
  });
});

describe(stripSourcesContentAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('removes sourcesContent, including when nested', async () => {
    const mapPath = path.join(distRoot, 'nested.map');
    vol.fromJSON({
      [mapPath]: JSON.stringify({
        version: 3,
        sourcesContent: ['outer'],
        sections: [{ map: { version: 3, sourcesContent: ['inner'], mappings: '' } }],
      }),
    });

    const strippedPath = await stripSourcesContentAsync(mapPath, 'ios');
    const stripped = JSON.parse(await fs.readFile(strippedPath, 'utf8'));

    expect(stripped.sourcesContent).toBeUndefined();
    expect(stripped.sections[0].map.sourcesContent).toBeUndefined();
    expect(stripped.version).toBe(3);
  });

  it('leaves the original file untouched', async () => {
    const mapPath = path.join(distRoot, 'original.map');
    vol.fromJSON({ [mapPath]: sourceMap() });

    await stripSourcesContentAsync(mapPath, 'android');

    const original = JSON.parse(await fs.readFile(mapPath, 'utf8'));
    expect(original.sourcesContent).toEqual(['console.log("hello");']);
  });

  it('rejects a source map that is not version 3', async () => {
    const mapPath = path.join(distRoot, 'bad.map');
    vol.fromJSON({ [mapPath]: JSON.stringify({ version: 2, mappings: '' }) });

    await expect(stripSourcesContentAsync(mapPath, 'ios')).rejects.toThrow(
      'Expected a version 3 source map'
    );
  });
});

describe(maybeUploadSourceMapsAsync, () => {
  const graphqlClient = instance(mock<ExpoGraphqlClient>());

  beforeEach(() => {
    vol.reset();
    jest.mocked(uploadFileAtPathToGCSAsync).mockReset();
  });

  it('uploads one stripped source map per platform', async () => {
    writeExport();
    jest
      .mocked(uploadFileAtPathToGCSAsync)
      .mockImplementation(async (_client, _type, filePath) =>
        filePath.includes('android') ? 'updates/android-key' : 'updates/ios-key'
      );

    await expect(maybeUploadSourceMapsAsync(distRoot, graphqlClient)).resolves.toEqual({
      android: { type: 'GCS', bucketKey: 'updates/android-key' },
      ios: { type: 'GCS', bucketKey: 'updates/ios-key' },
    });
    expect(uploadFileAtPathToGCSAsync).toHaveBeenCalledTimes(2);
    expect(jest.mocked(uploadFileAtPathToGCSAsync).mock.calls[0][1]).toBe(
      UPLOAD_SESSION_TYPE_EAS_UPDATE_SOURCE_MAPS
    );
  });

  it('uploads the stripped copy, not the original', async () => {
    writeExport({ platforms: ['ios'] });
    jest.mocked(uploadFileAtPathToGCSAsync).mockResolvedValue('updates/ios-key');

    await maybeUploadSourceMapsAsync(distRoot, graphqlClient);

    const uploadedPath = jest.mocked(uploadFileAtPathToGCSAsync).mock.calls[0][2];
    expect(uploadedPath).not.toBe(path.join(distRoot, `${iosBundle}.map`));
    expect(JSON.parse(await fs.readFile(uploadedPath, 'utf8')).sourcesContent).toBeUndefined();
  });

  it('skips a source map that is still over the size limit after stripping', async () => {
    const hugeMappings = 'A'.repeat(MAX_SOURCE_MAP_SIZE_BYTES + 1);
    vol.fromJSON({
      [path.join(distRoot, 'metadata.json')]: JSON.stringify({
        version: 0,
        bundler: 'metro',
        fileMetadata: { ios: { assets: [], bundle: iosBundle } },
      }),
      [path.join(distRoot, iosBundle)]: 'bundle',
      [path.join(distRoot, `${iosBundle}.map`)]: sourceMap({ mappings: hugeMappings }),
    });

    await expect(maybeUploadSourceMapsAsync(distRoot, graphqlClient)).resolves.toBeNull();
    expect(uploadFileAtPathToGCSAsync).not.toHaveBeenCalled();
  });

  it('returns only the platforms that have a source map', async () => {
    writeExport({ maps: false });
    vol.writeFileSync(path.join(distRoot, `${androidBundle}.map`), sourceMap());
    jest.mocked(uploadFileAtPathToGCSAsync).mockResolvedValue('updates/android-key');

    await expect(maybeUploadSourceMapsAsync(distRoot, graphqlClient)).resolves.toEqual({
      android: { type: 'GCS', bucketKey: 'updates/android-key' },
    });
  });

  it('returns null and does not throw when the upload fails', async () => {
    writeExport();
    jest.mocked(uploadFileAtPathToGCSAsync).mockRejectedValue(new Error('network down'));

    await expect(maybeUploadSourceMapsAsync(distRoot, graphqlClient)).resolves.toBeNull();
  });

  it('returns null when there is no metadata.json', async () => {
    vol.fromJSON({ [path.join(distRoot, 'placeholder')]: '' });

    await expect(maybeUploadSourceMapsAsync(distRoot, graphqlClient)).resolves.toBeNull();
    expect(uploadFileAtPathToGCSAsync).not.toHaveBeenCalled();
  });
});
