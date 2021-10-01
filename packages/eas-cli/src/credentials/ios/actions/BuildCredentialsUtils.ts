import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import { getProjectAccountName } from '../../../project/projectUtils';
import { findAccountByName } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';
import { App, Target } from '../types';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';

export async function getAllBuildCredentialsAsync(
  ctx: CredentialsContext,
  app: AppLookupParams
): Promise<IosAppBuildCredentialsFragment[]> {
  const appCredentials = await ctx.ios.getIosAppCredentialsWithBuildCredentialsAsync(app, {});
  if (!appCredentials) {
    return [];
  }
  return appCredentials.iosAppBuildCredentialsList;
}

export async function getBuildCredentialsAsync(
  ctx: CredentialsContext,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType
): Promise<IosAppBuildCredentialsFragment | null> {
  const appCredentials = await ctx.ios.getIosAppCredentialsWithBuildCredentialsAsync(app, {
    iosDistributionType,
  });
  if (!appCredentials || appCredentials.iosAppBuildCredentialsList.length === 0) {
    return null;
  }
  const [buildCredentials] = appCredentials.iosAppBuildCredentialsList;
  return buildCredentials;
}

export async function getProvisioningProfileAsync(
  ctx: CredentialsContext,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType
): Promise<AppleProvisioningProfileFragment | null> {
  const buildCredentials = await getBuildCredentialsAsync(ctx, app, iosDistributionType);
  return buildCredentials?.provisioningProfile ?? null;
}

export async function getDistributionCertificateAsync(
  ctx: CredentialsContext,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType
): Promise<AppleDistributionCertificateFragment | null> {
  const buildCredentials = await getBuildCredentialsAsync(ctx, app, iosDistributionType);
  return buildCredentials?.distributionCertificate ?? null;
}

export async function assignBuildCredentialsAsync(
  ctx: CredentialsContext,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType,
  distCert: AppleDistributionCertificateFragment,
  provisioningProfile: AppleProvisioningProfileFragment,
  appleTeam?: AppleTeamFragment
): Promise<IosAppBuildCredentialsFragment> {
  const resolvedAppleTeam = nullthrows(
    appleTeam ?? (await resolveAppleTeamIfAuthenticatedAsync(ctx, app))
  );
  const appleAppIdentifier = await ctx.ios.createOrGetExistingAppleAppIdentifierAsync(
    app,
    resolvedAppleTeam
  );
  return await ctx.ios.createOrUpdateIosAppBuildCredentialsAsync(app, {
    appleTeam: resolvedAppleTeam,
    appleAppIdentifierId: appleAppIdentifier.id,
    appleDistributionCertificateId: distCert.id,
    appleProvisioningProfileId: provisioningProfile.id,
    iosDistributionType,
  });
}

export function getAppFromContext(ctx: CredentialsContext): App {
  ctx.ensureProjectContext();
  const projectName = ctx.exp.slug;
  const accountName = getProjectAccountName(ctx.exp, ctx.user);
  const account = findAccountByName(ctx.user.accounts, accountName);
  if (!account) {
    throw new Error(`You do not have access to account: ${accountName}`);
  }
  return {
    account,
    projectName,
  };
}

export function getAppLookupParamsFromContext(
  ctx: CredentialsContext,
  target: Target
): AppLookupParams {
  const app = getAppFromContext(ctx);
  return { ...app, bundleIdentifier: target.bundleIdentifier };
}
