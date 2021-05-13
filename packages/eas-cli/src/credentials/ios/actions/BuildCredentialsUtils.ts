import { Platform } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { getBundleIdentifier } from '../../../build/ios/bundleIdentifier';
import { resolveWorkflow } from '../../../build/utils/workflow';
import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import { getProjectAccountName } from '../../../project/projectUtils';
import { findAccountByName } from '../../../user/Account';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';

export async function getAllBuildCredentialsAsync(
  ctx: Context,
  app: AppLookupParams
): Promise<IosAppBuildCredentialsFragment[]> {
  const appCredentials = await ctx.ios.getIosAppCredentialsWithBuildCredentialsAsync(app, {});
  if (!appCredentials) {
    return [];
  }
  return appCredentials.iosAppBuildCredentialsList;
}

export async function getBuildCredentialsAsync(
  ctx: Context,
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
  ctx: Context,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType
): Promise<AppleProvisioningProfileFragment | null> {
  const buildCredentials = await getBuildCredentialsAsync(ctx, app, iosDistributionType);
  return buildCredentials?.provisioningProfile ?? null;
}

export async function getDistributionCertificateAsync(
  ctx: Context,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType
): Promise<AppleDistributionCertificateFragment | null> {
  const buildCredentials = await getBuildCredentialsAsync(ctx, app, iosDistributionType);
  return buildCredentials?.distributionCertificate ?? null;
}

export async function assignBuildCredentialsAsync(
  ctx: Context,
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

export function getAppLookupParamsFromContext(ctx: Context): AppLookupParams {
  ctx.ensureProjectContext();
  const projectName = ctx.exp.slug;
  const accountName = getProjectAccountName(ctx.exp, ctx.user);
  const account = findAccountByName(ctx.user.accounts, accountName);
  if (!account) {
    throw new Error(`You do not have access to account: ${accountName}`);
  }

  const workflow = resolveWorkflow(ctx.projectDir, Platform.IOS);
  const bundleIdentifier = getBundleIdentifier({
    projectDir: ctx.projectDir,
    exp: ctx.exp,
    workflow,
  });

  return { account, projectName, bundleIdentifier };
}
