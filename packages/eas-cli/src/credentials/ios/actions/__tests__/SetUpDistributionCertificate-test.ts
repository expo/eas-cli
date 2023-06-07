import { IosDistributionType } from '../../../../graphql/generated';
import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testDistCertFragmentNoDependencies,
  testDistCertFromApple,
  testIosAppBuildCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpDistributionCertificate } from '../SetUpDistributionCertificate';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe('SetUpDistributionCertificate', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('creates a distribution certificate in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listDistributionCertificatesAsync: jest.fn(() => []),
      },
      ios: {
        ...getNewIosApiMock(),
        getDistributionCertificatesForAccountAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setUpDistCertAction = new SetUpDistributionCertificate(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setUpDistCertAction.runAsync(ctx);

    // expect distribution certificate to be created on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect distribution certificate to be created on apple portal
    expect(jest.mocked(ctx.appStore.createDistributionCertificateAsync).mock.calls.length).toBe(1);
  });

  it('creates a distribution certificate in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listDistributionCertificatesAsync: jest.fn(() => []),
      },
      ios: {
        ...getNewIosApiMock(),
        getDistributionCertificatesForAccountAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setUpDistCertAction = new SetUpDistributionCertificate(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setUpDistCertAction.runAsync(ctx);

    // expect distribution certificate to be created on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect distribution certificate to be created on apple portal
    expect(jest.mocked(ctx.appStore.createDistributionCertificateAsync).mock.calls.length).toBe(1);
  });

  it('does not create a distribution certificate if there is a valid one already', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listDistributionCertificatesAsync: jest.fn(() => [testDistCertFromApple]),
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
        ),
        getDistributionCertificateForAppAsync: jest.fn(() => testDistCertFragmentNoDependencies),
        getDistributionCertificatesForAccountAsync: jest.fn(() => [
          testDistCertFragmentNoDependencies,
        ]),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setUpDistCertAction = new SetUpDistributionCertificate(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setUpDistCertAction.runAsync(ctx);

    // expect distribution certificate to be created on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(0);
    // expect distribution certificate to be created on apple portal
    expect(jest.mocked(ctx.appStore.createDistributionCertificateAsync).mock.calls.length).toBe(0);
  });

  it('creates one if current is expired', async () => {
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60);
    const expiredCertificate = {
      ...testDistCertFragmentNoDependencies,
      validityNotAfter: anHourAgo.toISOString(),
    };
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listDistributionCertificatesAsync: jest.fn(() => [expiredCertificate]),
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => ({
          ...testCommonIosAppCredentialsFragment,
          iosAppBuildCredentialsList: [
            { ...testIosAppBuildCredentialsFragment, distributionCertificate: expiredCertificate },
          ],
        })),
        getDistributionCertificateForAppAsync: jest.fn(() => expiredCertificate),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setUpDistCertAction = new SetUpDistributionCertificate(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setUpDistCertAction.runAsync(ctx);

    // expect distribution certificate to be created on expo servers
    expect(jest.mocked(ctx.ios.createDistributionCertificateAsync).mock.calls.length).toBe(1);
    // expect distribution certificate to be created on apple portal
    expect(jest.mocked(ctx.appStore.createDistributionCertificateAsync).mock.calls.length).toBe(1);
  });

  it.only('does not create one if not authenticated with App Store', async () => {
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60);
    const expiredCertificate = {
      ...testDistCertFragmentNoDependencies,
      validityNotAfter: anHourAgo.toISOString(),
    };
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => null),
        authCtx: null,
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => ({
          ...testCommonIosAppCredentialsFragment,
          iosAppBuildCredentialsList: [expiredCertificate],
        })),
        getDistributionCertificateForAppAsync: jest.fn(() => expiredCertificate),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setUpDistCertAction = new SetUpDistributionCertificate(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await expect(setUpDistCertAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );
  });
});
