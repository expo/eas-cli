import assert from 'assert';
import chalk from 'chalk';
import dateformat from 'dateformat';

import {
  AppleDistributionCertificateFragment,
  AppleTeamFragment,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { promptAsync } from '../../../../prompts';
import { Account } from '../../../../user/Account';
import { fromNow } from '../../../../utils/date';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { filterRevokedDistributionCerts } from '../../appstore/CredentialsUtilsBeta';

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
  } = distributionCertificate;
  let line: string = '';
  if (developerPortalIdentifier) {
    line += `Cert ID: ${developerPortalIdentifier}`;
  }
  line += `${line === '' ? '' : ', '}Serial number: ${serialNumber}${
    appleTeam ? `, ${formatAppleTeam(appleTeam)}` : ''
  }`;
  line += chalk.gray(
    `\n    Created: ${fromNow(new Date(validityNotBefore))} ago, Expires: ${dateformat(
      validityNotAfter,
      'expiresHeaderFormat'
    )}`
  );

  if (validSerialNumbers?.includes(serialNumber)) {
    line += chalk.gray("\n    ✅ Currently valid on Apple's servers.");
  } else {
    line += '';
  }
  return line;
}

function formatAppleTeam({ appleTeamIdentifier, appleTeamName }: AppleTeamFragment): string {
  return `Team ID: ${appleTeamIdentifier}${appleTeamName ? `, Team name: ${appleTeamName}` : ''}`;
}

async function _selectDistributionCertificateAsync(
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
export async function selectDistributionCertificateAsync(
  ctx: Context,
  account: Account
): Promise<AppleDistributionCertificateFragment | null> {
  const distCertsForAccount = await ctx.newIos.getDistributionCertificatesForAccountAsync(account);
  if (distCertsForAccount.length === 0) {
    Log.warn(`There are no Distribution Certificates available in your EAS account.`);
    return null;
  }
  if (!ctx.appStore.authCtx) {
    return _selectDistributionCertificateAsync(distCertsForAccount);
  }

  // get valid certs on the developer portal
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validDistCerts = await filterRevokedDistributionCerts(
    distCertsForAccount,
    certInfoFromApple
  );

  return _selectDistributionCertificateAsync(distCertsForAccount, validDistCerts);
}

/**
 * select a distribution certificate from a valid set (curated on a best effort basis)
 * */
export async function selectValidDistributionCertificateAsync(
  ctx: Context,
  appLookupParams: AppLookupParams
): Promise<AppleDistributionCertificateFragment | null> {
  const distCertsForAccount = await ctx.newIos.getDistributionCertificatesForAccountAsync(
    appLookupParams.account
  );
  if (distCertsForAccount.length === 0) {
    Log.warn(`There are no Distribution Certificates available in your EAS account.`);
    return null;
  }
  if (!ctx.appStore.authCtx) {
    return _selectDistributionCertificateAsync(distCertsForAccount);
  }

  // filter by apple team
  assert(ctx.appStore.authCtx, 'authentication to the Apple App Store is required');
  const appleTeamIdentifier = ctx.appStore.authCtx.team.id;
  const distCertsForAppleTeam = distCertsForAccount.filter(distCert => {
    return !distCert.appleTeam || distCert.appleTeam.appleTeamIdentifier === appleTeamIdentifier;
  });

  // filter by valid certs on the developer portal
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validDistCerts = await filterRevokedDistributionCerts(
    distCertsForAppleTeam,
    certInfoFromApple
  );
  Log.log(
    `${validDistCerts.length}/${distCertsForAccount.length} Distribution Certificates are currently valid for Apple Team ${ctx.appStore.authCtx?.team.id}.`
  );
  return _selectDistributionCertificateAsync(validDistCerts);
}
