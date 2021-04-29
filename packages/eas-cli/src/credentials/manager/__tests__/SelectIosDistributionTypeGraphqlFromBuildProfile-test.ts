import { EasConfig } from '@expo/eas-json';

import { IosDistributionType as IosDistributionTypeGraphql } from '../../../graphql/generated';
import { createCtxMock } from '../../__tests__/fixtures-context';
import { testCommonIosAppCredentialsFragment } from '../../__tests__/fixtures-ios';
import { SelectIosDistributionTypeGraphqlFromBuildProfile } from '../SelectIosDistributionTypeGraphqlFromBuildProfile';

describe('SelectIosDistributionTypeGraphqlFromBuildProfile', () => {
  it('errors with a simulator distribution', async () => {
    const easConfig = {
      builds: {
        ios: {
          distribution: 'simulator',
        },
      },
    } as EasConfig;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction = new SelectIosDistributionTypeGraphqlFromBuildProfile(
      easConfig
    );
    await expect(
      selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(
        ctx,
        /* iosAppCredentials */ null
      )
    ).rejects.toThrowError();
  });
  it('returns APP_STORE type with a store distribution', async () => {
    const easConfig = {
      builds: {
        ios: {
          distribution: 'store',
        },
      },
    } as EasConfig;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction = new SelectIosDistributionTypeGraphqlFromBuildProfile(
      easConfig
    );
    const iosDistributionTypeGraphql = await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(
      ctx,
      /* iosAppCredentials */ null
    );
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.AppStore);
  });
  it('returns ENTERPRISE type with an internal distribution with the universal provisioningEnterprise configuration', async () => {
    const easConfig = {
      builds: {
        ios: {
          distribution: 'internal',
          enterpriseProvisioning: 'universal',
        },
      },
    } as EasConfig;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction = new SelectIosDistributionTypeGraphqlFromBuildProfile(
      easConfig
    );
    const iosDistributionTypeGraphql = await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(
      ctx,
      /* iosAppCredentials */ null
    );
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.Enterprise);
  });
  it('returns ADHOC type with an internal distribution with the adhoc provisioningEnterprise configuration', async () => {
    const easConfig = {
      builds: {
        ios: {
          distribution: 'internal',
          enterpriseProvisioning: 'adhoc',
        },
      },
    } as EasConfig;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction = new SelectIosDistributionTypeGraphqlFromBuildProfile(
      easConfig
    );
    const iosDistributionTypeGraphql = await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(
      ctx,
      /* iosAppCredentials */ null
    );
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.AdHoc);
  });
  it('extrapolates type for an internal distribution with ambiguous configuration', async () => {
    const easConfig = {
      builds: {
        ios: {
          distribution: 'internal',
        },
      },
    } as EasConfig;

    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const selectIosDistributionTypeGraphqlFromBuildProfileAction = new SelectIosDistributionTypeGraphqlFromBuildProfile(
      easConfig
    );

    // create deep clone the quick and dirty way
    const testAppCredentials = JSON.parse(JSON.stringify(testCommonIosAppCredentialsFragment));
    testAppCredentials.iosAppBuildCredentialsList[0].iosDistributionType =
      IosDistributionTypeGraphql.AdHoc;
    const iosDistributionTypeGraphql = await selectIosDistributionTypeGraphqlFromBuildProfileAction.runAsync(
      ctx,
      testAppCredentials
    );
    expect(iosDistributionTypeGraphql).toBe(IosDistributionTypeGraphql.AdHoc);
  });
});
