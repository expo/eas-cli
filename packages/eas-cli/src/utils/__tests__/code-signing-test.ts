import FormData from 'form-data';
import path from 'path';

import { Headers, Response } from '../../fetch';
import { PartialManifest } from '../../graphql/generated';
import {
  checkManifestBodyAgainstUpdateInfoGroup,
  getCodeSigningInfoAsync,
  getKeyAndCertificateFromPathsAsync,
  getManifestBodyAsync,
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

describe(getCodeSigningInfoAsync, () => {
  it('throws when codeSigningMetadata is not specified for EAS', async () => {
    await expect(
      getCodeSigningInfoAsync(
        {
          name: 'wat',
          slug: 'test',
          updates: {
            codeSigningCertificate: 'wat',
          },
        },
        'test'
      )
    ).rejects.toThrow(
      'Must specify codeSigningMetadata under the "updates" field of your app config file to use EAS code signing'
    );
  });
});

describe(getKeyAndCertificateFromPathsAsync, () => {
  it('throws an informative error when file at either path does not exist', async () => {
    const codeSigningCertificatePath = path.join(
      __dirname,
      './fixtures/certificate-path-not-exist.pem'
    );
    const privateKeyPath = path.join(__dirname, './fixtures/test-private-key.pem');
    await expect(
      getKeyAndCertificateFromPathsAsync({
        codeSigningCertificatePath,
        privateKeyPath,
      })
    ).rejects.toThrow(
      `Code signing certificate cannot be read from path: ${codeSigningCertificatePath}`
    );

    const codeSigningCertificatePath2 = path.join(__dirname, './fixtures/test-certificate.pem');
    const privateKeyPath2 = path.join(__dirname, './fixtures/private-key-path-not-exist.pem');
    await expect(
      getKeyAndCertificateFromPathsAsync({
        codeSigningCertificatePath: codeSigningCertificatePath2,
        privateKeyPath: privateKeyPath2,
      })
    ).rejects.toThrow(`Code signing private key cannot be read from path: ${privateKeyPath2}`);
  });

  it('loads certificate and private key', async () => {
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

describe(getManifestBodyAsync, () => {
  it('gets multipart manifest body', async () => {
    const stringifiedManifest = JSON.stringify({ hello: 'world' });
    const form = generateMultipartBody(stringifiedManifest);

    const body = await getManifestBodyAsync({
      arrayBuffer: async () => new Uint8Array(form.getBuffer()).buffer,
      headers: new Headers({
        'content-type': `multipart/mixed; boundary=${form.getBoundary()}`,
      }),
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
    expect(() => {
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest);
    }).not.toThrow();
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
    expect(() => {
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest);
    }).toThrow(
      `Code signing manifest integrity error: The manifest being signed contains an extra.expoClient field that does not match the initially uploaded manifest's extra.expoClient field`
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
    expect(() => {
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest);
    }).toThrow(
      'Code signing manifest integrity error: The manifest being signed has an assets array of differing length from the initially uploaded manifest'
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
    expect(() => {
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest);
    }).toThrow(
      'Code signing manifest integrity error: The manifest being signed has is missing an asset specified in the initially uploaded manifest: 3'
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
    expect(() => {
      checkManifestBodyAgainstUpdateInfoGroup(manifestResponseBodyJSON, partialManifest);
    }).toThrow(
      'Code signing manifest integrity error: Manifest asset tamper detected for asset: 2; field: contentType'
    );
  });
});
