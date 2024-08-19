import prompts from 'prompts';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleDeviceClass, AppleTeam } from '../../../../graphql/generated';
import { runInputMethodAsync } from '../inputMethod';

jest.mock('../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation');
jest.mock('../../../../ora');

beforeEach(() => {
  jest.mocked(prompts).mockReset();
  jest.mocked(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  jest.mocked(AppleDeviceMutation.createAppleDeviceAsync).mockClear();
});

describe(runInputMethodAsync, () => {
  it('should allow for multiple device registration', async () => {
    mockDeviceData('00001111-001122334455662E', 'my iPhone', AppleDeviceClass.Iphone);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
    mockDeviceData('00001111-001122334455662F', 'my Mac', AppleDeviceClass.Mac);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
    mockDeviceData('b12cba9856d89c932ab7a4b813c4d932534e1679', 'my iPad', AppleDeviceClass.Ipad);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: false }));

    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const accountId = 'account-id';
    // @ts-expect-error appleTeam is missing properties of AppleTeam GraphQL type
    const appleTeam: AppleTeam = {
      id: 'apple-team-id',
      appleTeamIdentifier: 'ABC123XY',
      appleTeamName: 'John Doe (Individual)',
    };

    await runInputMethodAsync(graphqlClient, accountId, appleTeam);

    expect(AppleDeviceMutation.createAppleDeviceAsync).toHaveBeenCalledTimes(3);
  });
});

function mockDeviceData(udid: string, name: string, deviceClass: AppleDeviceClass): void {
  jest.mocked(prompts).mockImplementationOnce(async () => ({ udid }));
  jest.mocked(prompts).mockImplementationOnce(async () => ({ name }));
  jest.mocked(prompts).mockImplementationOnce(async () => ({ deviceClass }));
  jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
}
