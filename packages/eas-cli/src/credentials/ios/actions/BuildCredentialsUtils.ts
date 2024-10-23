import nullthrows from 'nullthrows';

import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { App, Target } from '../types';

export async function getAllBuildCredentialsAsync(
  ctx: CredentialsContext,
  app: AppLookupParams
): Promise<IosAppBuildCredentialsFragment[]> {
  const appCredentials = await ctx.ios.getIosAppCredentialsWithBuildCredentialsAsync(
    ctx.graphqlClient,
    app,
    {}
  );
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
  const appCredentials = await ctx.ios.getIosAppCredentialsWithBuildCredentialsAsync(
    ctx.graphqlClient,
    app,
    {
      iosDistributionType,
    }
  );
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
    ctx.graphqlClient,
    app,
    resolvedAppleTeam
  );
  return await ctx.ios.createOrUpdateIosAppBuildCredentialsAsync(ctx.graphqlClient, app, {
    appleTeam: resolvedAppleTeam,
    appleAppIdentifierId: appleAppIdentifier.id,
    appleDistributionCertificateId: distCert.id,
    appleProvisioningProfileId: provisioningProfile.id,
    iosDistributionType,
  });
}

export async function getAppFromContextAsync(ctx: CredentialsContext): Promise<App> {
  const exp = await ctx.getExpoConfigAsync();
  const projectName = exp.slug;
  const projectId = await ctx.getProjectIdAsync();
  const account = await getOwnerAccountForProjectIdAsync(ctx.graphqlClient, projectId);
  return {
    account,
    projectName,
  };
}

export async function getAppLookupParamsFromContextAsync(
  ctx: CredentialsContext,
  target: Target
): Promise<AppLookupParams> {
  const app = await getAppFromContextAsync(ctx);
  return { ...app, bundleIdentifier: target.bundleIdentifier };
}
