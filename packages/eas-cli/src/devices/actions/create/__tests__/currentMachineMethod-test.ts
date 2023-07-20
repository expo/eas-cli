import prompts from 'prompts';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleDeviceClass, AppleTeam } from '../../../../graphql/generated';
import { runCurrentMachineMethodAsync } from '../currentMachineMethod';

jest.mock('../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation');
jest.mock('../../../../ora');

beforeEach(() => {
  jest.mocked(prompts).mockReset();
  jest.mocked(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  jest.mocked(AppleDeviceMutation.createAppleDeviceAsync).mockClear();
});

describe(runCurrentMachineMethodAsync, () => {
  it('proceeds with registration if user approves', async () => {
    mockDeviceData('my iPhone', AppleDeviceClass.Iphone);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
    mockDeviceData('my iPad', AppleDeviceClass.Ipad);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: false }));

    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const accountId = 'account-id';
    // @ts-expect-error appleTeam is missing properties of AppleTeam GraphQL type
    const appleTeam: AppleTeam = {
      id: 'apple-team-id',
      appleTeamIdentifier: 'ABC123XY',
      appleTeamName: 'John Doe (Individual)',
    };

    await runCurrentMachineMethodAsync(graphqlClient, accountId, appleTeam);

    expect(AppleDeviceMutation.createAppleDeviceAsync).toHaveBeenCalledTimes(1);
  });

  it('exits registration if user cancels', async () => {
    mockDeviceData('my iPhone', AppleDeviceClass.Iphone);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: false }));
    mockDeviceData('my iPad', AppleDeviceClass.Ipad);
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));

    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const accountId = 'account-id';
    // @ts-expect-error appleTeam is missing properties of AppleTeam GraphQL type
    const appleTeam: AppleTeam = {
      id: 'apple-team-id',
      appleTeamIdentifier: 'ABC123XY',
      appleTeamName: 'John Doe (Individual)',
    };

    await runCurrentMachineMethodAsync(graphqlClient, accountId, appleTeam);

    expect(AppleDeviceMutation.createAppleDeviceAsync).toHaveBeenCalledTimes(0);
  });
});

function mockDeviceData(name: string, deviceClass: AppleDeviceClass): void {
  jest.mocked(prompts).mockImplementationOnce(async () => ({ name }));
  jest.mocked(prompts).mockImplementationOnce(async () => ({ deviceClass }));
}
