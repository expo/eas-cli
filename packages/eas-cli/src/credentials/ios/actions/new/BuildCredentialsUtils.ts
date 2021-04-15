import { IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../../graphql/generated';
import {
  getProjectAccountName,
  getProjectConfigDescription,
} from '../../../../project/projectUtils';
import { findAccountByName } from '../../../../user/Account';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';

export async function getBuildCredentialsAsync(
  ctx: Context,
  app: AppLookupParams,
  iosDistributionType: GraphQLIosDistributionType
): Promise<IosAppBuildCredentialsFragment | null> {
  const appCredentials = await ctx.newIos.getIosAppCredentialsWithBuildCredentialsAsync(app, {
    iosDistributionType,
  });
  if (!appCredentials || appCredentials.iosAppBuildCredentialsArray.length === 0) {
    return null;
  }
  const [buildCredentials] = appCredentials.iosAppBuildCredentialsArray;
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
  const appleAppIdentifier = await ctx.newIos.createOrGetExistingAppleAppIdentifierAsync(
    app,
    resolvedAppleTeam
  );
  return await ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync(app, {
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

  const bundleIdentifier = ctx.exp.ios?.bundleIdentifier;
  if (!bundleIdentifier) {
    throw new Error(
      `ios.bundleIdentifier needs to be defined in your ${getProjectConfigDescription(
        ctx.projectDir
      )} file`
    );
  }

  return { account, projectName, bundleIdentifier };
}

export function resolveDistributionType(
  distribution: IosDistributionType,
  enterpriseProvisioning?: IosEnterpriseProvisioning
): GraphQLIosDistributionType {
  if (distribution === 'internal') {
    if (enterpriseProvisioning === 'adhoc') {
      return GraphQLIosDistributionType.AdHoc;
    } else if (enterpriseProvisioning === 'universal') {
      return GraphQLIosDistributionType.Enterprise;
    } else {
      return GraphQLIosDistributionType.AdHoc;
    }
  } else {
    return GraphQLIosDistributionType.AppStore;
  }
}
