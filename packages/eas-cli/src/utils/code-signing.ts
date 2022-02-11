import {
  convertCertificatePEMToCertificate,
  convertPrivateKeyPEMToPrivateKey,
  signStringRSASHA256AndVerify,
  validateSelfSignedCertificate,
} from '@expo/code-signing-certificates';
import { ExpoConfig } from '@expo/config';
import Dicer from 'dicer';
import isDeepEqual from 'fast-deep-equal';
import { promises as fs } from 'fs';
import { Response } from 'got';
import { pki as PKI } from 'node-forge';
import nullthrows from 'nullthrows';
import path from 'path';
import { Stream } from 'stream';
import { parseItem } from 'structured-headers';

import { PartialManifest, PartialManifestAsset } from '../graphql/generated';

type CodeSigningInfo = {
  privateKey: PKI.rsa.PrivateKey;
  certificate: PKI.Certificate;
  codeSigningMetadata: { alg: string; keyid: string };
};

export async function getCodeSigningInfoAsync(
  config: ExpoConfig,
  privateKeyPath: string | undefined
): Promise<CodeSigningInfo | undefined> {
  const codeSigningCertificatePath = config.updates?.codeSigningCertificate;
  const codeSigningMetadata = config.updates?.codeSigningMetadata;

  if (codeSigningCertificatePath && !privateKeyPath) {
    privateKeyPath = path.join(path.dirname(codeSigningCertificatePath), 'private-key.pem');
  }

  if (!codeSigningMetadata) {
    throw new Error(
      'Must specify codeSigningMetadata under the "updates" field of your app config file to use EAS code signing'
    );
  }

  const { alg, keyid } = codeSigningMetadata;
  if (!alg || !keyid) {
    throw new Error(
      'Must specify keyid and alg in the codeSigningMetadata field under the "updates" field of your app config file to use EAS code signing'
    );
  }

  return codeSigningCertificatePath && privateKeyPath
    ? {
        ...(await getKeyAndCertificateFromPathsAsync({
          codeSigningCertificatePath,
          privateKeyPath,
        })),
        codeSigningMetadata: {
          alg,
          keyid,
        },
      }
    : undefined;
}

async function readFileAsync(path: string, errorMessage: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    throw new Error(errorMessage);
  }
}

export async function getKeyAndCertificateFromPathsAsync({
  codeSigningCertificatePath,
  privateKeyPath,
}: {
  codeSigningCertificatePath: string;
  privateKeyPath: string;
}): Promise<{ privateKey: PKI.rsa.PrivateKey; certificate: PKI.Certificate }> {
  const [codeSigningCertificatePEM, privateKeyPEM] = await Promise.all([
    readFileAsync(
      codeSigningCertificatePath,
      `Code signing certificate cannot be read from path: ${codeSigningCertificatePath}`
    ),
    readFileAsync(
      privateKeyPath,
      `Code signing private key cannot be read from path: ${privateKeyPath}`
    ),
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
    throw new Error('The multipart manifest response is missing the content-type header');
  }

  const boundaryRegex = /^multipart\/.+?; boundary=(?:"([^"]+)"|([^\s;]+))/i;
  const matches = boundaryRegex.exec(contentType);
  if (!matches) {
    throw new Error('The content-type header in the HTTP response is not a multipart media type');
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
            part.body += data.toString();
          });
          p.on('end', () => {
            parts.push(part);
          });
        })
        .on('finish', () => {
          resolve(parts);
        })
        .on('error', error => {
          reject(error);
        })
    );
  });
}

function isManifestMultipartPart(multipartPart: MultipartPart): boolean {
  const [, parameters] = parseItem(nullthrows(multipartPart.headers.get('content-disposition')));
  const partName = parameters.get('name');
  return partName === 'manifest';
}

export async function getManifestBodyAsync(res: Response): Promise<string | null> {
  const multipartParts = await parseMultipartMixedResponseAsync(res);
  const manifestPart = multipartParts.find(isManifestMultipartPart);
  return manifestPart?.body ?? null;
}

export function signManifestBody(body: string, codeSigningInfo: CodeSigningInfo): string {
  return signStringRSASHA256AndVerify(
    codeSigningInfo.privateKey,
    codeSigningInfo.certificate,
    body
  );
}

function assertAssetParity(
  manifestResponseBodyAssetJSON: { [key: string]: any },
  partialManifestAsset: PartialManifestAsset
): void {
  const baseErrorMessage = `Code signing manifest integrity error: Manifest asset tamper detected for asset: ${partialManifestAsset.bundleKey}; field: `;
  if (manifestResponseBodyAssetJSON.hash !== partialManifestAsset.fileSHA256) {
    throw new Error(baseErrorMessage + 'hash');
  }
  if (manifestResponseBodyAssetJSON.contentType !== partialManifestAsset.contentType) {
    throw new Error(baseErrorMessage + 'contentType');
  }
  if (manifestResponseBodyAssetJSON.key !== partialManifestAsset.bundleKey) {
    throw new Error(baseErrorMessage + 'key');
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
      `Code signing manifest integrity error: The manifest being signed contains an extra.expoClient field that does not match the initially uploaded manifest's extra.expoClient field`
    );
  }

  assertAssetParity(manifestResponseBodyJSON.launchAsset, partialManifest.launchAsset);

  if (manifestResponseBodyJSON.assets.length !== partialManifest.assets.length) {
    throw new Error(
      'Code signing manifest integrity error: The manifest being signed has an assets array of differing length from the initially uploaded manifest'
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
        `Code signing manifest integrity error: The manifest being signed has is missing an asset specified in the initially uploaded manifest: ${partialManifestAssetBundleKey}`
      );
    }
    assertAssetParity(correspondingManifestResponseBodyAssetJSON, nullthrows(partialManifestAsset));
  }
}
