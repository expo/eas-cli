import FormData from 'form-data';
import { Response } from 'got';
import path from 'path';

import { PartialManifest } from '../../graphql/generated';
import {
  checkManifestBodyAgainstUpdateInfoGroup,
  getKeyAndCertificateFromPathsAsync,
  getManifestBodyAsync,
  parseMultipartMixedResponseAsync,
} from '../code-signing';

function generateMultipartBody(stringifiedManifest: string): FormData {
  const form = new FormData();
  // This generates a 26 + 24 character boundary similar to those used by Firefox and form-data.
  let boundary = '-----ExpoManifestBoundary-';
  for (let i = 0; i < 24; i++) {
    boundary += Math.floor(Math.random() * 16).toString(16);
  }
  form.setBoundary(boundary);
  form.append('manifest', stringifiedManifest, {
    contentType: 'application/json',
  });
  form.append('extensions', JSON.stringify({}), {
    contentType: 'application/json',
  });
  return form;
}

describe(getKeyAndCertificateFromPathsAsync, () => {
  it('loads certifivate and private key', async () => {
    const result = await getKeyAndCertificateFromPathsAsync({
      codeSigningCertificatePath: path.join(__dirname, './fixtures/test-certificate.pem'),
      privateKeyPath: path.join(__dirname, './fixtures/test-private-key.pem'),
    });
    expect(result.certificate).not.toBe(null);
    expect(result.privateKey).not.toBe(null);
  });

  it('validates certificate and private key', async () => {
    await expect(
      getKeyAndCertificateFromPathsAsync({
        codeSigningCertificatePath: path.join(__dirname, './fixtures/invalid-certificate.pem'),
        privateKeyPath: path.join(__dirname, './fixtures/invalid-private-key.pem'),
      })
    ).rejects.toThrow('Certificate validity expired');
  });
});

describe(parseMultipartMixedResponseAsync, () => {
  it('parses multipart response', async () => {
    const form = generateMultipartBody(JSON.stringify({ hello: 'world' }));

    const parts = await parseMultipartMixedResponseAsync({
      rawBody: form.getBuffer(),
      headers: {
        'content-type': `multipart/mixed; boundary=${form.getBoundary()}`,
      },
    } as any as Response);

    expect(parts).toHaveLength(2);
  });
});

describe(getManifestBodyAsync, () => {
  it('gets multipart manifest body', async () => {
    const stringifiedManifest = JSON.stringify({ hello: 'world' });
    const form = generateMultipartBody(stringifiedManifest);

    const body = await getManifestBodyAsync({
      rawBody: form.getBuffer(),
      headers: {
        'content-type': `multipart/mixed; boundary=${form.getBoundary()}`,
      },
    } as any as Response);

    expect(body).toEqual(stringifiedManifest);
  });
});

describe(checkManifestBodyAgainstUpdateInfoGroup, () => {
  it('returns void when valid', () => {
    const manifestResponseBodyJSON = JSON.stringify({
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        hash: '1',
        contentType: 'test/hex',
        key: '1',
      },
      assets: [
        {
          hash: '2',
          contentType: 'test/hex',
          key: '2',
        },
      ],
    });
    const partialManifest: PartialManifest = {
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        fileSHA256: '1',
        contentType: 'test/hex',
        bundleKey: '1',
        storageKey: 'wat',
      },
      assets: [
        {
          fileSHA256: '2',
          contentType: 'test/hex',
          bundleKey: '2',
          storageKey: 'wat',
        },
      ],
    };
    expect(() =>
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest)
    ).not.toThrow();
  });

  it('throws when extra.expoClient is tampered with', () => {
    const manifestResponseBodyJSON = JSON.stringify({
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        fileSHA256: '1',
        contentType: 'test/hex',
        bundleKey: '1',
        storageKey: 'wat',
      },
    });
    const partialManifest: PartialManifest = {
      extra: {
        expoClient: {
          test: 'wat',
          maliciousExtraKey: {
            nestedDeeply: {
              hello: 'world',
            },
          },
        },
      },
      launchAsset: {
        fileSHA256: '1',
        contentType: 'test/hex',
        bundleKey: '1',
        storageKey: 'wat',
      },
      assets: [],
    };
    expect(() =>
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest)
    ).toThrow(
      'Code signing manifest integrity error: Manifest extra.expoClient does not match uploaded manifest extra.expoClient'
    );
  });

  it('throws when assets differ in length', () => {
    const manifestResponseBodyJSON = JSON.stringify({
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        hash: '1',
        contentType: 'test/hex',
        key: '1',
      },
      assets: [
        {
          hash: '2',
          contentType: 'test/hex',
          key: '2',
        },
      ],
    });
    const partialManifest: PartialManifest = {
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        fileSHA256: '1',
        contentType: 'test/hex',
        bundleKey: '1',
        storageKey: 'wat',
      },
      assets: [],
    };
    expect(() =>
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest)
    ).toThrow(
      'Code signing manifest integrity error: Manifest assets differ in length from uploaded manifest assets'
    );
  });

  it('throws when an asset is not present', () => {
    const manifestResponseBodyJSON = JSON.stringify({
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        hash: '1',
        contentType: 'test/hex',
        key: '1',
      },
      assets: [
        {
          hash: '2',
          contentType: 'test/hex',
          key: '2',
        },
      ],
    });
    const partialManifest: PartialManifest = {
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        fileSHA256: '1',
        contentType: 'test/hex',
        bundleKey: '1',
        storageKey: 'wat',
      },
      assets: [
        {
          fileSHA256: '3',
          contentType: 'test/hex',
          bundleKey: '3',
          storageKey: 'wat',
        },
      ],
    };
    expect(() =>
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest)
    ).toThrow(
      'Code signing manifest integrity error: Manifest asset not found in uploaded manifest: 3'
    );
  });

  it('throws when an asset has been tampered with', () => {
    const manifestResponseBodyJSON = JSON.stringify({
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        hash: '1',
        contentType: 'test/hex',
        key: '1',
      },
      assets: [
        {
          hash: '2',
          contentType: 'test/hex',
          key: '2',
        },
      ],
    });
    const partialManifest: PartialManifest = {
      extra: {
        expoClient: {
          test: 'wat',
        },
      },
      launchAsset: {
        fileSHA256: '1',
        contentType: 'test/hex',
        bundleKey: '1',
        storageKey: 'wat',
      },
      assets: [
        {
          fileSHA256: '2',
          contentType: 'test/malicious',
          bundleKey: '2',
          storageKey: 'wat',
        },
      ],
    };
    expect(() =>
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest)
    ).toThrow('Code signing manifest integrity error: Manifest asset tamper detected for asset: 2');
  });
});
