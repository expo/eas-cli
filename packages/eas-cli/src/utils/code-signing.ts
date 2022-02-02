import {
  convertCertificatePEMToCertificate,
  convertPrivateKeyPEMToPrivateKey,
  signStringRSASHA256AndVerify,
  validateSelfSignedCertificate,
} from '@expo/code-signing-certificates';
import Dicer from 'dicer';
import isDeepEqual from 'fast-deep-equal';
import { promises as fs } from 'fs';
import { Response } from 'got';
import { pki as PKI } from 'node-forge';
import nullthrows from 'nullthrows';
import { Stream } from 'stream';
import { parseItem } from 'structured-headers';

import { PartialManifest, PartialManifestAsset } from '../graphql/generated';

export async function getKeyAndCertificateFromPathsAsync({
  codeSigningCertificatePath,
  privateKeyPath,
}: {
  codeSigningCertificatePath: string;
  privateKeyPath: string;
}): Promise<{ privateKey: PKI.rsa.PrivateKey; certificate: PKI.Certificate }> {
  const [codeSigningCertificatePEM, privateKeyPEM] = await Promise.all([
    fs.readFile(codeSigningCertificatePath, 'utf8'),
    fs.readFile(privateKeyPath, 'utf8'),
  ]);

  const privateKey = convertPrivateKeyPEMToPrivateKey(privateKeyPEM);
  const certificate = convertCertificatePEMToCertificate(codeSigningCertificatePEM);
  validateSelfSignedCertificate(certificate, {
    publicKey: certificate.publicKey as PKI.rsa.PublicKey,
    privateKey,
  });

  return {
    privateKey,
    certificate,
  };
}

export type MultipartPart = { headers: Map<string, string>; body: string };

export async function parseMultipartMixedResponseAsync(res: Response): Promise<MultipartPart[]> {
  const contentType = res.headers['content-type'];
  if (!contentType) {
    throw new Error('Missing content-type in multipart response');
  }

  const boundaryRegex = /^multipart\/.+?; boundary=(?:"(.+)"|([^\s]+))$/i;
  const matches = boundaryRegex.exec(contentType);
  if (!matches) {
    throw new Error('content-type header in response not multipart');
  }
  const boundary = matches[1] ?? matches[2];

  const bodyBuffer = res.rawBody;
  const bufferStream = new Stream.PassThrough();
  bufferStream.end(bodyBuffer);

  return await new Promise((resolve, reject) => {
    const parts: MultipartPart[] = [];
    bufferStream.pipe(
      new Dicer({ boundary })
        .on('part', p => {
          const part: MultipartPart = {
            body: '',
            headers: new Map(),
          };

          p.on('header', headers => {
            for (const h in headers) {
              part.headers.set(h, (headers as { [key: string]: string[] })[h][0]);
            }
          });
          p.on('data', data => {
            part.body = data.toString();
          });
          p.on('end', () => {
            parts.push(part);
          });
        })
        .on('finish', () => {
          resolve(parts);
        })
        .on('error', err => reject(err))
    );
  });
}

function isManifestMultipartPart(multipartPart: MultipartPart): boolean {
  const partName = parseItem(nullthrows(multipartPart.headers.get('content-disposition')))[1].get(
    'name'
  );
  return partName === 'manifest';
}

export async function getManifestBodyAsync(res: Response): Promise<string | null> {
  const multipartParts = await parseMultipartMixedResponseAsync(res);
  const manifestPart = multipartParts.find(isManifestMultipartPart);
  return manifestPart?.body ?? null;
}

export function signManifestBody(
  body: string,
  certificate: PKI.Certificate,
  privateKey: PKI.rsa.PrivateKey
): string {
  return signStringRSASHA256AndVerify(privateKey, certificate, body);
}

function assertAssetParity(
  manifestResponseBodyAssetJSON: { [key: string]: any },
  partialManifestAsset: PartialManifestAsset
): void {
  if (
    manifestResponseBodyAssetJSON.hash !== partialManifestAsset.fileSHA256 ||
    manifestResponseBodyAssetJSON.contentType !== partialManifestAsset.contentType ||
    manifestResponseBodyAssetJSON.key !== partialManifestAsset.bundleKey
  ) {
    throw new Error(
      `Code signing manifest integrity error: Manifest asset tamper detected for asset: ${partialManifestAsset.bundleKey}`
    );
  }
}

export function checkManifestBodyAgainstUpdateInfoGroup(
  manifestResponseBody: string,
  partialManifest: PartialManifest
): void {
  const manifestResponseBodyJSON = JSON.parse(manifestResponseBody);

  // Assert expoClient config is equal. We do not want to sign the manifest if the
  // server has compromised the integrity of the manifest.
  // JSON stringify and unstringify to remove any undefined values and bring it as close
  // to the server sanitized value as possible
  const isExtraEqual = isDeepEqual(
    JSON.parse(JSON.stringify(partialManifest.extra?.expoClient)),
    manifestResponseBodyJSON.extra?.expoClient
  );
  if (!isExtraEqual) {
    throw new Error(
      'Code signing manifest integrity error: Manifest extra.expoClient does not match uploaded manifest extra.expoClient'
    );
  }

  assertAssetParity(manifestResponseBodyJSON.launchAsset, partialManifest.launchAsset);

  if (manifestResponseBodyJSON.assets.length !== partialManifest.assets.length) {
    throw new Error(
      'Code signing manifest integrity error: Manifest assets differ in length from uploaded manifest assets'
    );
  }

  for (const partialManifestAsset of partialManifest.assets) {
    const partialManifestAssetBundleKey = nullthrows(partialManifestAsset).bundleKey;
    const correspondingManifestResponseBodyAssetJSON = manifestResponseBodyJSON.assets.find(
      (manifestResponseBodyAssetJSON: { [key: string]: any }) =>
        manifestResponseBodyAssetJSON.key === partialManifestAssetBundleKey
    );
    if (!correspondingManifestResponseBodyAssetJSON) {
      throw new Error(
        `Code signing manifest integrity error: Manifest asset not found in uploaded manifest: ${partialManifestAssetBundleKey}`
      );
    }
    assertAssetParity(correspondingManifestResponseBodyAssetJSON, nullthrows(partialManifestAsset));
  }
}
