import { Session, User } from '@expo/apple-utils';
import { Platform } from '@expo/eas-build-job';

import { getRequestContext } from '../../../credentials/ios/appstore/authenticate';
import {
  ensureAppExistsAsync,
  ensureBundleIdExistsWithNameAsync,
} from '../../../credentials/ios/appstore/ensureAppExists';
import { ensureTestFlightGroupExistsAsync } from '../../../credentials/ios/appstore/ensureTestFlightGroup';
import { SubmissionContext } from '../../context';
import { ensureAppStoreConnectAppExistsAsync } from '../AppProduce';

jest.mock('@expo/apple-utils', () => ({
  ...jest.requireActual('@expo/apple-utils'),
  Session: { getAnySessionInfo: jest.fn() },
  User: { getAsync: jest.fn() },
}));
jest.mock('../../../credentials/ios/appstore/authenticate', () => ({
  getRequestContext: jest.fn(),
}));
jest.mock('../../../credentials/ios/appstore/ensureAppExists', () => ({
  ensureAppExistsAsync: jest.fn(),
  ensureBundleIdExistsWithNameAsync: jest.fn(),
}));
jest.mock('../../../credentials/ios/appstore/ensureTestFlightGroup', () => ({
  ensureTestFlightGroupExistsAsync: jest.fn(),
}));
jest.mock('../../../log');

function createContext({
  autoTestFlightSetup,
}: {
  autoTestFlightSetup: boolean;
}): SubmissionContext<Platform.IOS> {
  return {
    nonInteractive: false,
    autoTestFlightSetup,
    exp: { name: 'Example', slug: 'example' },
    profile: { bundleIdentifier: 'com.example.app', appName: 'Example' },
    credentialsCtx: {
      appStore: {
        ensureUserAuthenticatedAsync: jest.fn(async () => ({ appleId: 'dev@example.com' })),
      },
    },
  } as unknown as SubmissionContext<Platform.IOS>;
}

describe(ensureAppStoreConnectAppExistsAsync, () => {
  beforeEach(() => {
    jest
      .mocked(getRequestContext)
      .mockReset()
      .mockReturnValue({} as any);
    jest
      .mocked(Session.getAnySessionInfo)
      .mockReset()
      .mockReturnValue({ user: { emailAddress: 'dev@example.com' } } as any);
    jest
      .mocked(User.getAsync)
      .mockReset()
      .mockResolvedValue([{ attributes: { provisioningAllowed: true } }] as any);
    jest.mocked(ensureBundleIdExistsWithNameAsync).mockReset();
    jest
      .mocked(ensureAppExistsAsync)
      .mockReset()
      .mockResolvedValue({ id: '12345678' } as any);
    jest.mocked(ensureTestFlightGroupExistsAsync).mockReset();
  });

  it('sets up the internal TestFlight group when auto TestFlight setup is enabled', async () => {
    await expect(
      ensureAppStoreConnectAppExistsAsync(createContext({ autoTestFlightSetup: true }))
    ).resolves.toEqual({ ascAppIdentifier: '12345678' });

    expect(ensureTestFlightGroupExistsAsync).toHaveBeenCalledWith(
      { id: '12345678' },
      { nonInteractive: false }
    );
  });

  it('skips the internal TestFlight group when auto TestFlight setup is disabled', async () => {
    await expect(
      ensureAppStoreConnectAppExistsAsync(createContext({ autoTestFlightSetup: false }))
    ).resolves.toEqual({ ascAppIdentifier: '12345678' });

    expect(ensureTestFlightGroupExistsAsync).not.toHaveBeenCalled();
  });
});
