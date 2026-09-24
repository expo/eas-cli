import { App, User } from '@expo/apple-utils';
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { ensureSubmissionTestFlightSetupAsync } from '../../utils/submission/testFlightSetup';

jest.mock('@expo/apple-utils');

describe(ensureSubmissionTestFlightSetupAsync, () => {
  let privateKey: string;

  beforeAll(async () => {
    const keys = await generateKeyPair('ES256');
    privateKey = await exportPKCS8(keys.privateKey);
  });

  it.each([undefined, 'issuer-id'])(
    'uses ASC authentication for issuer %s and preserves existing groups',
    async issuer => {
      const createGroup = jest.fn();
      jest.mocked(App.infoAsync).mockResolvedValue({
        getBetaGroupsAsync: async () => [{}],
        createBetaGroupAsync: createGroup,
      } as unknown as App);
      await ensureSubmissionTestFlightSetupAsync(
        { key: privateKey, key_id: 'KEYID', issuer_id: issuer },
        '123',
        createMockLogger()
      );
      const token = jest.mocked(App.infoAsync).mock.calls[0][0].token as string;
      expect(decodeJwt(token)).toMatchObject(issuer ? { iss: issuer } : { sub: 'user' });
      expect(createGroup).not.toHaveBeenCalled();
      expect(User.getAsync).not.toHaveBeenCalled();
    }
  );

  it('creates an automatic internal group and invites administrators', async () => {
    const assign = jest
      .fn()
      .mockResolvedValue({ attributes: { betaTesters: [{ assignmentResult: 'ASSIGNED' }] } });
    const createGroup = jest
      .fn()
      .mockResolvedValue({ createBulkBetaTesterAssignmentsAsync: assign });
    jest.mocked(App.infoAsync).mockResolvedValue({
      getBetaGroupsAsync: async () => [],
      createBetaGroupAsync: createGroup,
    } as unknown as App);
    jest
      .mocked(User.getAsync)
      .mockResolvedValue([
        { attributes: { roles: ['ADMIN'], email: 'admin@example.com', firstName: 'Admin' } },
        { attributes: { roles: ['DEVELOPER'], email: 'developer@example.com' } },
      ] as User[]);
    await ensureSubmissionTestFlightSetupAsync(
      { key: privateKey, key_id: 'KEYID' },
      '123',
      createMockLogger()
    );
    expect(createGroup).toHaveBeenCalledWith({
      name: 'Team (Expo)',
      isInternalGroup: true,
      hasAccessToAllBuilds: true,
    });
    expect(assign).toHaveBeenCalledWith([
      { email: 'admin@example.com', firstName: 'Admin', lastName: '' },
    ]);
  });

  it('does not expose request errors or stop submission when Apple rejects setup', async () => {
    jest.mocked(App.infoAsync).mockRejectedValue(new Error('request contains SECRET_TOKEN'));
    const logger = createMockLogger();
    await ensureSubmissionTestFlightSetupAsync({ key: privateKey, key_id: 'KEYID' }, '123', logger);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Submission will continue'));
    expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain('SECRET_TOKEN');
  });
});
