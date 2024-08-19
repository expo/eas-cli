import os from 'os';
import prompts from 'prompts';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleTeam } from '../../../../graphql/generated';
import { DeviceCreateError } from '../../../utils/errors';
import { runCurrentMachineMethodAsync } from '../currentMachineMethod';

jest.mock('../../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation');
jest.mock('../../../../ora');
jest.mock('os', () => {
  return {
    ...jest.requireActual('os'),
    cpus: jest.fn(),
  };
});
jest.mock('@expo/spawn-async', () => {
  return {
    __esModule: true,
    ...jest.requireActual('@expo/spawn-async'),
    default: jest.fn(async () => {
      return {
        stdout: JSON.stringify({
          SPHardwareDataType: [
            {
              provisioning_UDID: 'fake_udid',
              machine_name: 'fake_machine_name',
            },
          ],
        }),
      };
    }),
  };
});

let actualPlatform: string;
beforeAll(() => {
  actualPlatform = process.platform;
});

beforeEach(() => {
  jest.mocked(prompts).mockReset();
  jest.mocked(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  jest.mocked(AppleDeviceMutation.createAppleDeviceAsync).mockClear();
});

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: actualPlatform });
});

describe(runCurrentMachineMethodAsync, () => {
  it('allows registering the default Mac device class', async () => {
    jest.mocked(os.cpus).mockImplementation(() => [{ model: 'Apple M1' } as os.CpuInfo]);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockDeviceData('my Mac');
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

    expect(AppleDeviceMutation.createAppleDeviceAsync).toHaveBeenCalledTimes(1);
  });

  it('proceeds with registration if user approves, only once', async () => {
    jest.mocked(os.cpus).mockImplementation(() => [{ model: 'Apple M1' } as os.CpuInfo]);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockDeviceData('my Mac');
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
    mockDeviceData('my other Mac');
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
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockDeviceData('my Mac');
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: false }));
    mockDeviceData('my other Mac');
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

  it('exits registration if current Mac machine is not of Apple Silicon type', async () => {
    jest
      .mocked(os.cpus)
      .mockImplementation(() => [{ model: 'Intel(R) Core(TM) i5' } as os.CpuInfo]);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockDeviceData('my old Mac');
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
    mockDeviceData('my other Mac');
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

  it('exits registration if current machine is not Mac', async () => {
    jest
      .mocked(os.cpus)
      .mockImplementation(() => [{ model: 'Intel(R) Core(TM) i5' } as os.CpuInfo]);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockDeviceData('my Windows PC');
    jest.mocked(prompts).mockImplementationOnce(async () => ({ value: true }));
    mockDeviceData('my other Mac');
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

function mockDeviceData(name: string): void {
  jest.mocked(prompts).mockImplementationOnce(async () => ({ name }));
}
