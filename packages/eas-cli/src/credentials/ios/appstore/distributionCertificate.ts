import ora from 'ora';

import { DistributionCertificate, DistributionCertificateStoreInfo } from './Credentials.types';
import { AuthCtx } from './authenticate';
import { runActionAsync, travelingFastlane } from './fastlane';

export class AppleTooManyCertsError extends Error {}

export async function listDistributionCertificatesAsync(
  ctx: AuthCtx
): Promise<DistributionCertificateStoreInfo[]> {
  const spinner = ora(`Getting Distribution Certificates from Apple...`).start();
  try {
    const args = ['list', ctx.appleId, ctx.appleIdPassword, ctx.team.id, String(ctx.team.inHouse)];
    const { certs } = await runActionAsync(travelingFastlane.manageDistCerts, args);
    spinner.succeed();
    return certs;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export async function createDistributionCertificateAsync(
  ctx: AuthCtx
): Promise<DistributionCertificate> {
  const spinner = ora(`Creating Distribution Certificate on Apple Servers...`).start();
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
    const args = [
      'revoke',
      ctx.appleId,
      ctx.appleIdPassword,
      ctx.team.id,
      String(ctx.team.inHouse),
      ids.join(','),
    ];
    await runActionAsync(travelingFastlane.manageDistCerts, args);
    spinner.succeed();
  } catch (error) {
    spinner.fail('Failed to revoke Distribution Certificate on Apple Servers');
    throw error;
  }
}
