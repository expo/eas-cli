import { asMock } from '../../../../__tests__/utils';
import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../../../graphql/generated';
import { promptAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAllBuildCredentialsAsync } from '../BuildCredentialsUtils';
import { SetUpAdhocProvisioningProfile } from '../SetUpAdhocProvisioningProfile';
import { SetUpInternalProvisioningProfile } from '../SetUpInternalProvisioningProfile';
import { SetUpProvisioningProfile } from '../SetUpProvisioningProfile';

jest.mock('../../../../prompts');
jest.mock('../SetUpAdhocProvisioningProfile');
jest.mock('../SetUpProvisioningProfile');
jest.mock('../BuildCredentialsUtils', () => ({ getAllBuildCredentialsAsync: jest.fn() }));

beforeEach(() => {
  asMock(promptAsync).mockReset();

  asMock(getAllBuildCredentialsAsync).mockReset();
  asMock(getAllBuildCredentialsAsync).mockImplementation(() => {
    throw new Error(
      `unhandled getAllBuildCredentialsAsync call - this shouldn't happen - fix tests!`
    );
  });
});

const testAdhocBuildCredentials: IosAppBuildCredentialsFragment = {
  id: 'test-app-build-credentials-id-1',
  iosDistributionType: IosDistributionType.AdHoc,
};
const testEnterpriseBuildCredentials: IosAppBuildCredentialsFragment = {
  id: 'test-app-build-credentials-id-2',
  iosDistributionType: IosDistributionType.Enterprise,
};

describe(SetUpInternalProvisioningProfile, () => {
  describe('interactive mode', () => {
    describe('when authenticated with apple', () => {
      it('runs the SetUpAdhocProvisioningProfile action for non-enterprise team', async () => {
        asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
          const buildCredentials: IosAppBuildCredentialsFragment[] = [];
          return buildCredentials;
        });
        const action = new SetUpInternalProvisioningProfile({
          account: { id: 'account-id', name: 'account-name' },
          bundleIdentifier: 'com.expo.test',
          projectName: 'testproject',
        });
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: {
            ...getAppstoreMock(),
            ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
            authCtx: testAuthCtx,
          },
        });

        const runAsync = jest.fn();
        SetUpAdhocProvisioningProfile.prototype.runAsync = runAsync;

        await action.runAsync(ctx);

        expect(runAsync).toHaveBeenCalled();
      });

      it('asks the user for an action to run when they have access to an enterprise team', async () => {
        asMock(promptAsync).mockImplementationOnce(() => ({
          distributionType: IosDistributionType.Enterprise,
        }));
        asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
          const buildCredentials: IosAppBuildCredentialsFragment[] = [];
          return buildCredentials;
        });

        const action = new SetUpInternalProvisioningProfile({
          account: { id: 'account-id', name: 'account-name' },
          bundleIdentifier: 'com.expo.test',
          projectName: 'testproject',
        });
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: {
            ...getAppstoreMock(),
            ensureAuthenticatedAsync: jest.fn(() => ({
              ...testAuthCtx,
              team: { ...testAuthCtx.team, inHouse: true },
            })),
            authCtx: { ...testAuthCtx, team: { ...testAuthCtx.team, inHouse: true } },
          },
        });

        const runAsync = jest.fn();
        SetUpProvisioningProfile.prototype.runAsync = runAsync;

        await action.runAsync(ctx);

        expect(runAsync).toHaveBeenCalled();
      });
    });
    describe('when not authenticated with apple', () => {
      it('asks the user for an action to run when both adhoc and universal distribution credentials exist', async () => {
        asMock(promptAsync).mockImplementationOnce(() => ({
          distributionType: IosDistributionType.Enterprise,
        }));
        asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
          const buildCredentials: IosAppBuildCredentialsFragment[] = [
            testAdhocBuildCredentials,
            testEnterpriseBuildCredentials,
          ];
          return buildCredentials;
        });

        const action = new SetUpInternalProvisioningProfile({
          account: { id: 'account-id', name: 'account-name' },
          bundleIdentifier: 'com.expo.test',
          projectName: 'testproject',
        });
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: {
            ...getAppstoreMock(),
            ensureAuthenticatedAsync: jest.fn(() => null),
            authCtx: null,
          },
        });

        const runAsync = jest.fn();
        SetUpProvisioningProfile.prototype.runAsync = runAsync;

        await action.runAsync(ctx);

        expect(runAsync).toHaveBeenCalled();
      });

      it('runs the SetUpAdhocProvisioningProfile action when adhoc credentials exist', async () => {
        asMock(promptAsync).mockImplementationOnce(() => ({
          distributionType: IosDistributionType.Enterprise,
        }));
        asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
          const buildCredentials: IosAppBuildCredentialsFragment[] = [testAdhocBuildCredentials];
          return buildCredentials;
        });

        const action = new SetUpInternalProvisioningProfile({
          account: { id: 'account-id', name: 'account-name' },
          bundleIdentifier: 'com.expo.test',
          projectName: 'testproject',
        });
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: {
            ...getAppstoreMock(),
            ensureAuthenticatedAsync: jest.fn(() => null),
            authCtx: null,
          },
        });

        const runAsync = jest.fn();
        SetUpAdhocProvisioningProfile.prototype.runAsync = runAsync;

        await action.runAsync(ctx);

        expect(runAsync).toHaveBeenCalled();
      });

      it('runs the SetUpProvisioningProfile action when enterprise credentials exist', async () => {
        asMock(promptAsync).mockImplementationOnce(() => ({
          distributionType: IosDistributionType.Enterprise,
        }));
        asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
          const buildCredentials: IosAppBuildCredentialsFragment[] = [
            testEnterpriseBuildCredentials,
          ];
          return buildCredentials;
        });

        const action = new SetUpInternalProvisioningProfile({
          account: { id: 'account-id', name: 'account-name' },
          bundleIdentifier: 'com.expo.test',
          projectName: 'testproject',
        });
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: {
            ...getAppstoreMock(),
            ensureAuthenticatedAsync: jest.fn(() => null),
            authCtx: null,
          },
        });

        const runAsync = jest.fn();
        SetUpProvisioningProfile.prototype.runAsync = runAsync;

        await action.runAsync(ctx);

        expect(runAsync).toHaveBeenCalled();
      });

      it('forces the apple authentication when neither adhoc nor enterprise credentials exist', async () => {
        asMock(promptAsync).mockImplementationOnce(() => ({
          distributionType: IosDistributionType.Enterprise,
        }));
        asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
          const buildCredentials: IosAppBuildCredentialsFragment[] = [];
          return buildCredentials;
        });

        const action = new SetUpInternalProvisioningProfile({
          account: { id: 'account-id', name: 'account-name' },
          bundleIdentifier: 'com.expo.test',
          projectName: 'testproject',
        });
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: {
            ...getAppstoreMock(),
            ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
            authCtx: null,
          },
        });

        await action.runAsync(ctx);

        expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalled();
      });
    });
  });

  describe('non-interactive mode', () => {
    it('throws an error when both adhoc and enterprise credentials are set up', async () => {
      asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
        const buildCredentials: IosAppBuildCredentialsFragment[] = [
          testAdhocBuildCredentials,
          testEnterpriseBuildCredentials,
        ];
        return buildCredentials;
      });
      const action = new SetUpInternalProvisioningProfile({
        account: { id: 'account-id', name: 'account-name' },
        bundleIdentifier: 'com.expo.test',
        projectName: 'testproject',
      });
      const ctx = createCtxMock({
        nonInteractive: true,
      });
      await expect(action.runAsync(ctx)).rejects.toThrow(
        /You have set up both adhoc and universal distribution credentials/
      );
    });

    it('throws an error when neither adhoc nor enterprise credentials are set up', async () => {
      asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
        const buildCredentials: IosAppBuildCredentialsFragment[] = [];
        return buildCredentials;
      });
      const action = new SetUpInternalProvisioningProfile({
        account: { id: 'account-id', name: 'account-name' },
        bundleIdentifier: 'com.expo.test',
        projectName: 'testproject',
      });
      const ctx = createCtxMock({
        nonInteractive: true,
      });
      await expect(action.runAsync(ctx)).rejects.toThrow(/couldn't find any credentials/);
    });

    it('runs the SetUpAdhocProvisioningProfile action when adhoc credentials exist', async () => {
      asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
        const buildCredentials: IosAppBuildCredentialsFragment[] = [testAdhocBuildCredentials];
        return buildCredentials;
      });
      const action = new SetUpInternalProvisioningProfile({
        account: { id: 'account-id', name: 'account-name' },
        bundleIdentifier: 'com.expo.test',
        projectName: 'testproject',
      });
      const ctx = createCtxMock({
        nonInteractive: true,
      });

      const runAsync = jest.fn();
      SetUpAdhocProvisioningProfile.prototype.runAsync = runAsync;

      await action.runAsync(ctx);

      expect(runAsync).toHaveBeenCalled();
    });

    it('runs the SetUpProvisioningProfile action when enterprise credentials exist', async () => {
      asMock(getAllBuildCredentialsAsync).mockImplementationOnce(() => {
        const buildCredentials: IosAppBuildCredentialsFragment[] = [testEnterpriseBuildCredentials];
        return buildCredentials;
      });
      const action = new SetUpInternalProvisioningProfile({
        account: { id: 'account-id', name: 'account-name' },
        bundleIdentifier: 'com.expo.test',
        projectName: 'testproject',
      });
      const ctx = createCtxMock({
        nonInteractive: true,
      });

      const runAsync = jest.fn();
      SetUpProvisioningProfile.prototype.runAsync = runAsync;

      await action.runAsync(ctx);

      expect(runAsync).toHaveBeenCalled();
    });
  });
});
