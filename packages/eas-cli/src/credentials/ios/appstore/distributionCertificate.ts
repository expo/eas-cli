import { Certificate, CertificateType, createCertificateAndP12Async } from '@expo/apple-utils';
import ora from 'ora';

import { DistributionCertificate, DistributionCertificateStoreInfo } from './Credentials.types';
import { AuthCtx } from './authenticate';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';

export class AppleTooManyCertsError extends Error {}

export async function getCertificateBySerialNumberAsync(
  serialNumber: string
): Promise<Certificate> {
  const cert = (
    await Certificate.getAsync({
      query: { filter: { serialNumber: [serialNumber] } },
    })
  ).find(item => item.attributes.serialNumber === serialNumber);
  if (!cert) {
    throw new Error(`No certificate exists with serial number "${serialNumber}"`);
  }
  return cert;
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
  ctx: AuthCtx
): Promise<DistributionCertificateStoreInfo[]> {
  const spinner = ora(`Getting Distribution Certificates from Apple...`).start();
  try {
    if (USE_APPLE_UTILS) {
      const certs = (
        await Certificate.getAsync({
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
    }

    const args = ['list', ctx.appleId, ctx.appleIdPassword, ctx.team.id, String(ctx.team.inHouse)];
    const { certs } = await runActionAsync(travelingFastlane.manageDistCerts, args);
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
  ctx: AuthCtx
): Promise<DistributionCertificate> {
  const spinner = ora(`Creating Distribution Certificate on Apple Servers...`).start();
  if (USE_APPLE_UTILS) {
    try {
      const results = await createCertificateAndP12Async({
        certificateType: CertificateType.IOS_DISTRIBUTION,
      });
      spinner.succeed();
      return {
        certId: results.certificate.id,
        certP12: results.certificateP12,
        certPassword: results.password,
        certPrivateSigningKey: results.privateSigningKey,
        distCertSerialNumber: results.certificate.attributes.serialNumber,
        teamId: ctx.team.id,
        teamName: ctx.team.name,
      };
    } catch (error) {
      spinner.fail('Failed to create Distribution Certificate on Apple Servers');
      // TODO: Move check into apple-utils
      const resultString = error.message;
      if (
        resultString?.match(
          /You already have a current .* certificate or a pending certificate request./
        )
      ) {
        throw new AppleTooManyCertsError('Maximum number of certificates generated');
      }
      throw error;
    }
  }

  try {
    const args = [
      'create',
      ctx.appleId,
      ctx.appleIdPassword,
      ctx.team.id,
      String(ctx.team.inHouse),
    ];
    const result = {
      ...(await runActionAsync(travelingFastlane.manageDistCerts, args)),
      teamId: ctx.team.id,
      teamName: ctx.team.name,
    };
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail('Failed to create Distribution Certificate on Apple Servers');
    const resultString = err.rawDump?.resultString;
    if (resultString && resultString.match(/Maximum number of certificates generated/)) {
      throw new AppleTooManyCertsError('Maximum number of certificates generated');
    }
    throw err;
  }
}

export async function revokeDistributionCertificateAsync(
  ctx: AuthCtx,
  ids: string[]
): Promise<void> {
  const spinner = ora(`Revoking Distribution Certificate on Apple Servers...`).start();
  try {
    if (USE_APPLE_UTILS) {
      for (const id of ids) {
        await Certificate.deleteAsync({
          id,
        });
      }
    } else {
      const args = [
        'revoke',
        ctx.appleId,
        ctx.appleIdPassword,
        ctx.team.id,
        String(ctx.team.inHouse),
        ids.join(','),
      ];
      await runActionAsync(travelingFastlane.manageDistCerts, args);
    }

    spinner.succeed();
  } catch (error) {
    spinner.fail('Failed to revoke Distribution Certificate on Apple Servers');
    throw error;
  }
}
