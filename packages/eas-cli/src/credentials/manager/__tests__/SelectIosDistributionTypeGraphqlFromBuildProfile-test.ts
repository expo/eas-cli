import { IosBuildProfile } from '@expo/eas-json';

import { IosDistributionType as IosDistributionTypeGraphql } from '../../../graphql/generated';
import { createCtxMock } from '../../__tests__/fixtures-context';
import { SelectIosDistributionTypeGraphqlFromBuildProfile } from '../SelectIosDistributionTypeGraphqlFromBuildProfile';

describe('SelectIosDistributionTypeGraphqlFromBuildProfile', () => {
  it('errors with a simulator distribution', async () => {
    const buildProfile = {
      simulator: true,
    } as IosBuildProfile;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction =
      new SelectIosDistributionTypeGraphqlFromBuildProfile(buildProfile);
    await expect(
      selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(ctx)
    ).rejects.toThrowError();
  });
  it('returns APP_STORE type with a store distribution', async () => {
    const buildProfile = {
      distribution: 'store',
    } as IosBuildProfile;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction =
      new SelectIosDistributionTypeGraphqlFromBuildProfile(buildProfile);
    const iosDistributionTypeGraphql =
      await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(ctx);
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.AppStore);
  });
  it('returns ENTERPRISE type with an internal distribution with the universal provisioningEnterprise configuration', async () => {
    const buildProfile = {
      distribution: 'internal',
      enterpriseProvisioning: 'universal',
    } as IosBuildProfile;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction =
      new SelectIosDistributionTypeGraphqlFromBuildProfile(buildProfile);
    const iosDistributionTypeGraphql =
      await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(ctx);
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.Enterprise);
  });
  it('returns ADHOC type with an internal distribution with the adhoc provisioningEnterprise configuration', async () => {
    const buildProfile = {
      distribution: 'internal',
      enterpriseProvisioning: 'adhoc',
    } as IosBuildProfile;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction =
      new SelectIosDistributionTypeGraphqlFromBuildProfile(buildProfile);
    const iosDistributionTypeGraphql =
      await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(ctx);
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.AdHoc);
  });
});
