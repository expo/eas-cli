import assert from 'assert';
import chalk from 'chalk';
import dateformat from 'dateformat';

import { formatAppleTeam } from './AppleTeamFormatting';
import { AccountFragment, AppleDistributionCertificateFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { fromNow } from '../../../utils/date';
import { CredentialsContext } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import {
  DistributionCertificate,
  DistributionCertificateStoreInfo,
} from '../appstore/Credentials.types';
import { filterRevokedDistributionCertsFromEasServers } from '../appstore/CredentialsUtils';
import { AppleTooManyCertsError } from '../appstore/distributionCertificate';
import { distributionCertificateSchema } from '../credentials';
import { validateDistributionCertificateAsync } from '../validators/validateDistributionCertificate';

export function formatDistributionCertificate(
  distributionCertificate: AppleDistributionCertificateFragment,
  validSerialNumbers?: string[]
): string {
  const {
    serialNumber,
    developerPortalIdentifier,
    appleTeam,
    validityNotBefore,
    validityNotAfter,
    updatedAt,
  } = distributionCertificate;
  let line: string = '';
  if (developerPortalIdentifier) {
    line += `Cert ID: ${developerPortalIdentifier}`;
  }
  line += `${line === '' ? '' : ', '}Serial number: ${serialNumber}${
    appleTeam ? `, ${formatAppleTeam(appleTeam)}` : ''
  }`;
  line += chalk.gray(
    `\n    Created: ${fromNow(new Date(validityNotBefore))} ago, Updated: ${fromNow(
      new Date(updatedAt)
    )} ago,`
  );
  line += chalk.gray(`\n    Expires: ${dateformat(validityNotAfter, 'expiresHeaderFormat')}`);
  const apps = distributionCertificate.iosAppBuildCredentialsList.map(
    buildCredentials => buildCredentials.iosAppCredentials.app
  );
  if (apps.length) {
    // iosAppBuildCredentialsList is capped at 20 on www
    const appFullNames = apps
      .map(app => app.fullName)
      .slice(0, 19)
      .join(',');
    const andMaybeMore = apps.length > 19 ? ' (and more)' : '';
    line += chalk.gray(`\n    📲 Used by: ${appFullNames}${andMaybeMore}`);
  }

  if (validSerialNumbers?.includes(serialNumber)) {
    line += chalk.gray("\n    ✅ Currently valid on Apple's servers.");
  } else {
    line += '';
  }
  return line;
}

async function selectDistributionCertificateAsync(
  distCerts: AppleDistributionCertificateFragment[],
  validDistributionCertificates?: AppleDistributionCertificateFragment[]
): Promise<AppleDistributionCertificateFragment | null> {
  const validDistCertSerialNumbers = validDistributionCertificates?.map(
    distCert => distCert.serialNumber
  );
  const { chosenDistCert } = await promptAsync({
    type: 'select',
    name: 'chosenDistCert',
    message: 'Select certificate from the list.',
    choices: distCerts.map(distCert => ({
      title: formatDistributionCertificate(distCert, validDistCertSerialNumbers),
      value: distCert,
    })),
  });
  return chosenDistCert;
}

/**
 * select a distribution certificate from an account (validity status shown on a best effort basis)
 * */
export async function selectDistributionCertificateWithDependenciesAsync(
  ctx: CredentialsContext,
  account: AccountFragment
): Promise<AppleDistributionCertificateFragment | null> {
  const distCertsForAccount = await ctx.ios.getDistributionCertificatesForAccountAsync(
    ctx.graphqlClient,
    account
  );
  if (distCertsForAccount.length === 0) {
    Log.warn(`There are no Distribution Certificates available in your EAS account.`);
    return null;
  }
  if (!ctx.appStore.authCtx) {
    return await selectDistributionCertificateAsync(distCertsForAccount);
  }

  // get valid certs on the developer portal
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validDistCerts = await filterRevokedDistributionCertsFromEasServers(
    distCertsForAccount,
    certInfoFromApple
  );

  return await selectDistributionCertificateAsync(distCertsForAccount, validDistCerts);
}

/**
 * select a distribution certificate from a valid set (curated on a best effort basis)
 * */
export async function selectValidDistributionCertificateAsync(
  ctx: CredentialsContext,
  appLookupParams: AppLookupParams
): Promise<AppleDistributionCertificateFragment | null> {
  const distCertsForAccount = await ctx.ios.getDistributionCertificatesForAccountAsync(
    ctx.graphqlClient,
    appLookupParams.account
  );
  if (distCertsForAccount.length === 0) {
    Log.warn(`There are no Distribution Certificates available in your EAS account.`);
    return null;
  }
  if (!ctx.appStore.authCtx) {
    return await selectDistributionCertificateAsync(distCertsForAccount);
  }

  // filter by apple team
  assert(ctx.appStore.authCtx, 'authentication to the Apple App Store is required');
  const appleTeamIdentifier = ctx.appStore.authCtx.team.id;
  const distCertsForAppleTeam = distCertsForAccount.filter(distCert => {
    return !distCert.appleTeam || distCert.appleTeam.appleTeamIdentifier === appleTeamIdentifier;
  });

  // filter by valid certs on the developer portal
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validDistCerts = filterRevokedDistributionCertsFromEasServers(
    distCertsForAppleTeam,
    certInfoFromApple
  );
  Log.log(
    `${validDistCerts.length}/${distCertsForAccount.length} Distribution Certificates are currently valid for Apple Team ${ctx.appStore.authCtx?.team.id}.`
  );
  return await selectDistributionCertificateAsync(validDistCerts);
}

const APPLE_DIST_CERTS_TOO_MANY_GENERATED_ERROR = `
You can have only ${chalk.underline(
  'three'
)} Apple Distribution Certificates generated on your Apple Developer account.
Revoke the old ones or reuse existing from your other apps.
Remember that Apple Distribution Certificates are not application specific!
`;

export async function provideOrGenerateDistributionCertificateAsync(
  ctx: CredentialsContext
): Promise<DistributionCertificate> {
  if (!ctx.nonInteractive) {
    const userProvided = await promptForDistCertAsync(ctx);
    if (userProvided) {
      if (!ctx.appStore.authCtx) {
        Log.warn(
          'Unable to validate distribution certificate, you are not authenticated with Apple.'
        );
        return userProvided;
      } else {
        const isValid = await validateDistributionCertificateAsync(ctx, userProvided);
        if (!isValid) {
          Log.warn("Provided Distribution Certificate is no longer valid on Apple's server");
        }
        return isValid ? userProvided : await provideOrGenerateDistributionCertificateAsync(ctx);
      }
    }
  }
  return await generateDistributionCertificateAsync(ctx);
}

async function promptForDistCertAsync(
  ctx: CredentialsContext
): Promise<DistributionCertificate | null> {
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
  ctx: CredentialsContext
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
      Log.log(learnMore('https://docs.expo.dev/distribution/app-signing/#summary'));
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
  return await generateDistributionCertificateAsync(ctx);
}

function formatDistributionCertificateFromApple(
  appleInfo: DistributionCertificateStoreInfo
): string {
  const { name, status, id, expires, created, ownerName, serialNumber } = appleInfo;
  const expiresDate = new Date(expires * 1000).toDateString();
  const createdDate = new Date(created * 1000).toDateString();
  return [
    `🍏 ${chalk.bold(name)} (${status})`,
    `${chalk.bold('ID:')} ${id} ${chalk.bold('Serial Number:')} ${serialNumber}`,
    `${chalk.bold('Apple Team:')} ${appleInfo.ownerId} (${ownerName})`,
    `${chalk.bold('Expires:')} ${expiresDate} ${chalk.bold('Created:')} ${createdDate}`,
  ].join('\n\t');
}
