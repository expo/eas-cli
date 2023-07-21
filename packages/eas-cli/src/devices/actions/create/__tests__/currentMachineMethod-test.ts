import os from 'os';
import prompts from 'prompts';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleDeviceClass, AppleTeam } from '../../../../graphql/generated';
import { DeviceCreateError } from '../../../utils/errors';
import { runCurrentMachineMethodAsync } from '../currentMachineMethod';

jest.setTimeout(60000);

jest.mock('../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation');
jest.mock('../../../../ora');
jest.mock('os', () => {
  return {
    ...jest.requireActual('os'),
    cpus: jest.fn(),
    arch: jest.fn(),
  };
});

beforeEach(() => {
  jest.mocked(prompts).mockReset();
  jest.mocked(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  jest.mocked(AppleDeviceMutation.createAppleDeviceAsync).mockClear();
});

describe(runCurrentMachineMethodAsync, () => {
  it('proceeds with registration if user approves', async () => {
    jest.mocked(os.cpus).mockImplementation(() => [{ model: 'Apple M1' } as os.CpuInfo]);
    jest.mocked(os.arch).mockImplementation(() => 'arm64');
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
    jest.mocked(os.cpus).mockImplementation(() => [{ model: 'Apple M1' } as os.CpuInfo]);
    jest.mocked(os.arch).mockImplementation(() => 'arm64');
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

  it('exits registration if current machine is not of Apple Silicon type', async () => {
    jest
      .mocked(os.cpus)
      .mockImplementation(() => [{ model: 'Intel(R) Core(TM) i5' } as os.CpuInfo]);
    jest.mocked(os.arch).mockImplementation(() => 'x64');
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

    await expect(
      runCurrentMachineMethodAsync(graphqlClient, accountId, appleTeam)
    ).rejects.toThrowError(
      new DeviceCreateError(
        "Current machine is not of Apple Silicon type - provisioning UDID can't be added automatically."
      )
    );

    expect(AppleDeviceMutation.createAppleDeviceAsync).toHaveBeenCalledTimes(0);
  });
});

function mockDeviceData(name: string, deviceClass: AppleDeviceClass): void {
  jest.mocked(prompts).mockImplementationOnce(async () => ({ name }));
  jest.mocked(prompts).mockImplementationOnce(async () => ({ deviceClass }));
}
