import {
  Certificate,
  CertificateType,
  RequestContext,
  createCertificateAndP12Async,
} from '@expo/apple-utils';
import ora from 'ora';

import { DistributionCertificate, DistributionCertificateStoreInfo } from './Credentials.types';
import { AuthCtx, getRequestContext } from './authenticate';

export class AppleTooManyCertsError extends Error {}

export async function getCertificateBySerialNumberAsync(
  context: RequestContext,
  serialNumber: string
): Promise<Certificate> {
  const cert = (
    await Certificate.getAsync(context, {
      query: { filter: { serialNumber: [serialNumber] } },
    })
  ).find(item => item.attributes.serialNumber === serialNumber);
  if (!cert) {
    throw new Error(`No certificate exists with serial number "${serialNumber}"`);
  }
  return cert;
}

export async function getMostRecentCertificateAsync(
  context: RequestContext
): Promise<Certificate | null> {
  const [certificate] = await Certificate.getAsync(context, {
    query: {
      filter: {
        certificateType: CertificateType.IOS_DISTRIBUTION,
      },
      // Only require a single value.
      limit: 1,
      // Sort the serial numbers in reverse order to get the last one
      // also skip specifying a serial number.
      sort: '-serialNumber',
    },
  });
  return certificate ?? null;
}

export async function getDistributionCertificateAync(
  context: RequestContext,
  serialNumber: string
): Promise<Certificate | null> {
  const [certificate] = await Certificate.getAsync(context, {
    query: {
      filter: {
        // Specifying a serial number to query.
        serialNumber,
        certificateType: CertificateType.IOS_DISTRIBUTION,
      },
      // Only require a single value.
      limit: 1,
    },
  });
  return certificate ?? null;
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
  const spinner = ora(`Getting Distribution Certificates from Apple...`).start();
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
    spinner.succeed();
    return certs;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

/**
 * Run from `eas credentials` -> iOS -> Add new Distribution Certificate
 */
export async function createDistributionCertificateAsync(
  authCtx: AuthCtx
): Promise<DistributionCertificate> {
  const spinner = ora(`Creating Distribution Certificate on Apple Servers...`).start();
  try {
    const context = getRequestContext(authCtx);
    const results = await createCertificateAndP12Async(context, {
      certificateType: CertificateType.IOS_DISTRIBUTION,
    });
    spinner.succeed();
    return {
      certId: results.certificate.id,
      certP12: results.certificateP12,
      certPassword: results.password,
      certPrivateSigningKey: results.privateSigningKey,
      distCertSerialNumber: results.certificate.attributes.serialNumber,
      teamId: authCtx.team.id,
      teamName: authCtx.team.name,
    };
  } catch (error) {
    spinner.fail('Failed to create Distribution Certificate on Apple Servers');
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
  const spinner = ora(`Revoking Distribution Certificate on Apple Servers...`).start();
  try {
    const context = getRequestContext(authCtx);
    await Promise.all(ids.map(id => Certificate.deleteAsync(context, { id })));

    spinner.succeed();
  } catch (error) {
    spinner.fail('Failed to revoke Distribution Certificate on Apple Servers');
    throw error;
  }
}
