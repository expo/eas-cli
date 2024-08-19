import {
  convertCertificatePEMToCertificate,
  convertPrivateKeyPEMToPrivateKey,
  signBufferRSASHA256AndVerify,
  validateSelfSignedCertificate,
} from '@expo/code-signing-certificates';
import { ExpoConfig } from '@expo/config';
import {
  isMultipartPartWithName,
  parseMultipartMixedResponseAsync,
} from '@expo/multipart-body-parser';
import isDeepEqual from 'fast-deep-equal';
import { promises as fs } from 'fs';
import { pki as PKI } from 'node-forge';
import nullthrows from 'nullthrows';

import areSetsEqual from './expodash/areSetsEqual';
import { Response } from '../fetch';
import { PartialManifest, PartialManifestAsset } from '../graphql/generated';

export type CodeSigningInfo = {
  privateKey: PKI.rsa.PrivateKey;
  certificate: PKI.Certificate;
  codeSigningMetadata: { alg: string; keyid: string };
};

export async function getCodeSigningInfoAsync(
  config: ExpoConfig,
  privateKeyPath: string | undefined
): Promise<CodeSigningInfo | undefined> {
  const codeSigningCertificatePath = config.updates?.codeSigningCertificate;
  if (!codeSigningCertificatePath) {
    return undefined;
  }

  if (!privateKeyPath) {
    throw new Error('Must specify --private-key-path argument to sign update for code signing');
  }

  const codeSigningMetadata = config.updates?.codeSigningMetadata;
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

  return {
    ...(await getKeyAndCertificateFromPathsAsync({
      codeSigningCertificatePath,
      privateKeyPath,
    })),
    codeSigningMetadata: {
      alg,
      keyid,
    },
  };
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

async function getMultipartBodyPartAsync(res: Response, partName: string): Promise<string | null> {
  const contentType = res.headers.get('content-type');
  if (!contentType) {
    throw new Error('The multipart manifest response is missing the content-type header');
  }
  const bodyBuffer = await res.arrayBuffer();
  const multipartParts = await parseMultipartMixedResponseAsync(
    contentType,
    Buffer.from(bodyBuffer)
  );
  const manifestPart = multipartParts.find(part => isMultipartPartWithName(part, partName));
  return manifestPart?.body ?? null;
}

export async function getManifestBodyAsync(res: Response): Promise<string | null> {
  return await getMultipartBodyPartAsync(res, 'manifest');
}

export async function getDirectiveBodyAsync(res: Response): Promise<string | null> {
  return await getMultipartBodyPartAsync(res, 'directive');
}

export function signBody(body: string, codeSigningInfo: CodeSigningInfo): string {
  return signBufferRSASHA256AndVerify(
    codeSigningInfo.privateKey,
    codeSigningInfo.certificate,
    Buffer.from(body, 'utf-8')
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

export function checkDirectiveBodyAgainstUpdateInfoGroup(directiveResponseBody: string): void {
  const directiveResponseBodyJSON = JSON.parse(directiveResponseBody);

  if (
    !areSetsEqual(
      new Set(Object.keys(directiveResponseBodyJSON)),
      new Set(['extra', 'type', 'parameters'])
    )
  ) {
    throw new Error('Code signing directive integrity error: Unexpected keys');
  }

  if (directiveResponseBodyJSON.type !== 'rollBackToEmbedded') {
    throw new Error('Code signing directive integrity error: Incorrect directive type');
  }
}
