import {
  Certificate,
  CertificateType,
  RequestContext,
  createCertificateAndP12Async,
} from '@expo/apple-utils';

import { DistributionCertificate, DistributionCertificateStoreInfo } from './Credentials.types';
import { getRequestContext } from './authenticate';
import { AuthCtx } from './authenticateTypes';
import { ora } from '../../../ora';

export class AppleTooManyCertsError extends Error {}

export async function getCertificateBySerialNumberAsync(
  context: RequestContext,
  serialNumber: string
): Promise<Certificate> {
  const cert = (await Certificate.getAsync(context)).find(
    item => item.attributes.serialNumber === serialNumber
  );
  if (!cert) {
    throw new Error(`No certificate exists with serial number "${serialNumber}"`);
  }
  return cert;
}

export async function getDistributionCertificateAsync(
  context: RequestContext,
  serialNumber: string
): Promise<Certificate | null> {
  // At most, this returns 2 values.
  const certificates = await Certificate.getAsync(context, {
    query: {
      filter: {
        certificateType: [CertificateType.IOS_DISTRIBUTION, CertificateType.DISTRIBUTION],
      },
    },
  });
  return (
    certificates.find(certificate => certificate.attributes.serialNumber === serialNumber) ?? null
  );
}

export function transformCertificate(cert: Certificate): DistributionCertificateStoreInfo {
  return {
    id: cert.id,
    name: cert.attributes.name,
    status: cert.attributes.status,
    created: new Date(cert.attributes.requestedDate).getTime() / 1000,
    expires: new Date(cert.attributes.expirationDate).getTime() / 1000,
    ownerName: cert.attributes.ownerName,
    ownerId: cert.attributes.ownerId,
    serialNumber: cert.attributes.serialNumber,
  };
}

export async function listDistributionCertificatesAsync(
  authCtx: AuthCtx
): Promise<DistributionCertificateStoreInfo[]> {
  const spinner = ora(`Fetching Apple distribution certificates`).start();
  try {
    const context = getRequestContext(authCtx);
    const certs = (
      await Certificate.getAsync(context, {
        query: {
          filter: {
            certificateType: [
              CertificateType.DISTRIBUTION,
              CertificateType.IOS_DISTRIBUTION,
              CertificateType.MAC_APP_DISTRIBUTION,
            ],
          },
        },
      })
    ).map(transformCertificate);
    spinner.succeed(`Fetched Apple distribution certificates`);
    return certs;
  } catch (error) {
    spinner.fail(`Failed to fetch Apple distribution certificates`);
    throw error;
  }
}

/**
 * Run from `eas credentials` -> iOS -> Add new Distribution Certificate
 */
export async function createDistributionCertificateAsync(
  authCtx: AuthCtx
): Promise<DistributionCertificate> {
  const spinner = ora(`Creating Apple distribution certificate`).start();
  try {
    const context = getRequestContext(authCtx);
    const results = await createCertificateAndP12Async(context, {
      certificateType: CertificateType.IOS_DISTRIBUTION,
    });
    spinner.succeed(`Created Apple distribution certificate`);
    return {
      certId: results.certificate.id,
      certP12: results.certificateP12,
      certPassword: results.password,
      certPrivateSigningKey: results.privateSigningKey,
      distCertSerialNumber: results.certificate.attributes.serialNumber,
      teamId: authCtx.team.id,
      teamName: authCtx.team.name,
    };
  } catch (error: any) {
    spinner.fail('Failed to create Apple distribution certificate');
    // TODO: Move check into apple-utils
    if (
      /You already have a current .* certificate or a pending certificate request/.test(
        error.message
      )
    ) {
      throw new AppleTooManyCertsError('Maximum number of certificates generated');
    }
    throw error;
  }
}

export async function revokeDistributionCertificateAsync(
  authCtx: AuthCtx,
  ids: string[]
): Promise<void> {
  const name = `Apple distribution certificate${ids?.length === 1 ? '' : 's'}`;
  const spinner = ora(`Revoking ${name}`).start();
  try {
    const context = getRequestContext(authCtx);
    await Promise.all(ids.map(id => Certificate.deleteAsync(context, { id })));

    spinner.succeed(`Revoked ${name}`);
  } catch (error) {
    spinner.fail(`Failed to revoke ${name}`);
    throw error;
  }
}
