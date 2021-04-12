import chalk from 'chalk';

import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { Context } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { AppleTooManyCertsError } from '../appstore/AppStoreApi';
import {
  DistributionCertificate,
  DistributionCertificateStoreInfo,
} from '../appstore/Credentials.types';
import {
  filterRevokedDistributionCerts,
  sortCertificatesByExpiryDesc,
} from '../appstore/CredentialsUtils';
import {
  IosAppCredentials,
  IosDistCredentials,
  distributionCertificateSchema,
} from '../credentials';
import { findP12CertSerialNumber } from '../utils/p12Certificate';
import { validateDistributionCertificateAsync } from '../validators/validateDistributionCertificate';

const APPLE_DIST_CERTS_TOO_MANY_GENERATED_ERROR = `
You can have only ${chalk.underline(
  'three'
)} Apple Distribution Certificates generated on your Apple Developer account.
Please revoke the old ones or reuse existing from your other apps.
Please remember that Apple Distribution Certificates are not application specific!
`;

export async function provideOrGenerateDistributionCertificateAsync(
  ctx: Context,
  accountName: string
): Promise<DistributionCertificate> {
  if (!ctx.nonInteractive) {
    const userProvided = await promptForDistCertAsync(ctx);
    if (userProvided) {
      if (!ctx.appStore.authCtx) {
        Log.warn(
          'Unable to validate distribution certificate due to insufficient Apple Credentials'
        );
        return userProvided;
      } else {
        const isValid = await validateDistributionCertificateAsync(ctx, userProvided);
        if (!isValid) {
          Log.warn("Provided Distribution Certificate is no longer valid on Apple's server");
        }
        return isValid
          ? userProvided
          : await provideOrGenerateDistributionCertificateAsync(ctx, accountName);
      }
    }
  }
  return await generateDistributionCertificateAsync(ctx, accountName);
}

async function promptForDistCertAsync(ctx: Context): Promise<DistributionCertificate | null> {
  let initialValues: { teamId?: string } = {};
  if (ctx.appStore.authCtx) {
    initialValues = {
      teamId: ctx.appStore.authCtx.team.id,
    };
  }
  const userProvided = await askForUserProvidedAsync(distributionCertificateSchema, initialValues);
  if (!userProvided) {
    return null;
  }
  if (ctx.appStore.authCtx && userProvided.teamId === initialValues.teamId) {
    return {
      ...userProvided,
      teamName: ctx.appStore.authCtx.team.name,
    };
  }
  return userProvided;
}

async function generateDistributionCertificateAsync(
  ctx: Context,
  accountName: string
): Promise<DistributionCertificate> {
  await ctx.appStore.ensureAuthenticatedAsync();
  try {
    return await ctx.appStore.createDistributionCertificateAsync();
  } catch (e) {
    if (e instanceof AppleTooManyCertsError) {
      const distCerts = await ctx.appStore.listDistributionCertificatesAsync();
      Log.warn('Maximum number of Distribution Certificates generated on Apple Developer Portal.');
      Log.warn(APPLE_DIST_CERTS_TOO_MANY_GENERATED_ERROR);

      if (ctx.nonInteractive) {
        throw new Error(
          "Start the CLI without the '--non-interactive' flag to revoke existing certificates."
        );
      }

      Log.log(
        chalk.grey(
          `✅  Distribution Certificates can be revoked with no side effects for App Store builds.`
        )
      );
      Log.log(learnMore('https://docs.expo.io/distribution/app-signing/#summary'));
      Log.newLine();

      const { distCertsToRevoke } = await promptAsync({
        type: 'multiselect',
        name: 'distCertsToRevoke',
        message: 'Select certificates to revoke.',
        // @ts-expect-error property missing from `@types/prompts`
        optionsPerPage: 20,
        choices: distCerts.map(distCert => ({
          value: distCert,
          title: formatDistributionCertificateFromApple(distCert),
        })),
      });

      if (distCertsToRevoke.length > 0) {
        const ids = distCertsToRevoke.map(({ id }: DistributionCertificateStoreInfo) => id);
        await ctx.appStore.revokeDistributionCertificateAsync(ids);
      }
    } else {
      throw e;
    }
  }
  return await generateDistributionCertificateAsync(ctx, accountName);
}

interface SelectOptions {
  filterInvalid?: boolean;
}
type ValidityStatus = 'UNKNOWN' | 'VALID' | 'INVALID';

export async function selectDistributionCertificateAsync(
  ctx: Context,
  accountName: string,
  options: SelectOptions = {}
): Promise<IosDistCredentials | null> {
  const credentials = await ctx.ios.getAllCredentialsAsync(accountName);
  let distCredentials = credentials.userCredentials.filter(
    (cred): cred is IosDistCredentials => cred.type === 'dist-cert'
  );
  let validDistCredentials: IosDistCredentials[] | null = null;
  if (ctx.appStore.authCtx) {
    const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
    validDistCredentials = filterRevokedDistributionCerts(distCredentials, certInfoFromApple);
  }
  distCredentials =
    options.filterInvalid && validDistCredentials ? validDistCredentials : distCredentials;

  if (distCredentials.length === 0) {
    Log.warn('There are no Distribution Certificates available in your Expo account.');
    return null;
  }

  const format = (distCredentials: IosDistCredentials): string => {
    const usedByApps = credentials.appCredentials.filter(
      cred => cred.distCredentialsId === distCredentials.id
    );
    let validityStatus: ValidityStatus;
    if (!validDistCredentials) {
      validityStatus = 'UNKNOWN';
    } else if (validDistCredentials.includes(distCredentials)) {
      validityStatus = 'VALID';
    } else {
      validityStatus = 'INVALID';
    }
    return formatDistributionCertificate(distCredentials, usedByApps, validityStatus);
  };

  const { credentialsIndex } = await promptAsync({
    type: 'select',
    name: 'credentialsIndex',
    message: 'Select certificate from the list.',
    choices: distCredentials.map((entry, index) => ({
      title: format(entry),
      value: index,
    })),
  });
  return distCredentials[credentialsIndex];
}

export function formatDistributionCertificate(
  distributionCertificate: IosDistCredentials,
  usedByApps: IosAppCredentials[],
  validityStatus: ValidityStatus = 'UNKNOWN'
): string {
  const joinApps = usedByApps.map(i => `${i.experienceName} (${i.bundleIdentifier})`).join(', ');

  const usedByString = joinApps
    ? `\n    ${chalk.gray(`used by ${joinApps}`)}`
    : `\n    ${chalk.gray(`not used by any apps`)}`;

  let serialNumber = distributionCertificate.distCertSerialNumber;
  try {
    if (!serialNumber) {
      serialNumber = findP12CertSerialNumber(
        distributionCertificate.certP12,
        distributionCertificate.certPassword
      );
    }
  } catch (error) {
    serialNumber = chalk.red('invalid serial number');
  }

  let validityText;
  if (validityStatus === 'VALID') {
    validityText = chalk.gray("\n    ✅ Currently valid on Apple's servers.");
  } else if (validityStatus === 'INVALID') {
    validityText = chalk.gray("\n    ❌ No longer valid on Apple's servers.");
  } else {
    validityText = chalk.gray(
      "\n    ❓ Validity of this certificate on Apple's servers is unknown."
    );
  }
  return `Distribution Certificate (Cert ID: ${
    distributionCertificate.certId || '-----'
  }, Serial number: ${serialNumber}, Team ID: ${
    distributionCertificate.teamId
  })${usedByString}${validityText}`;
}

function formatDistributionCertificateFromApple(
  appleInfo: DistributionCertificateStoreInfo
): string {
  const { name, status, id, expires, created, ownerName, serialNumber } = appleInfo;
  const expiresDate = new Date(expires * 1000).toDateString();
  const createdDate = new Date(created * 1000).toDateString();
  return `${name} (${status}) - Cert ID: ${id}, Serial number: ${serialNumber}, Team ID: ${appleInfo.ownerId}, Team name: ${ownerName}
    expires: ${expiresDate}, created: ${createdDate}`;
}

export async function getValidDistCertsAsync(
  ctx: Context,
  accountName: string
): Promise<IosDistCredentials[]> {
  const credentials = await ctx.ios.getAllCredentialsAsync(accountName);
  const distCredentials = credentials.userCredentials.filter(
    (cred): cred is IosDistCredentials => cred.type === 'dist-cert'
  );
  if (!ctx.appStore.authCtx) {
    Log.log(chalk.yellow(`Unable to determine validity of Distribution Certificates.`));
    return distCredentials;
  }
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validCerts = await filterRevokedDistributionCerts(distCredentials, certInfoFromApple);
  return sortCertificatesByExpiryDesc(certInfoFromApple, validCerts);
}
