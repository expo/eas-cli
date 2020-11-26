import { AppleDevice } from '../../../../../../graphql/generated';

const AppleDeviceMutation = {
  createAppleDeviceAsync: jest.fn().mockImplementation(() => {
    const appleDevice: Pick<AppleDevice, 'id' | 'identifier'> = {
      id: 'apple-device-id',
      identifier: '00009999-000D6666146B888E',
    };
    return appleDevice;
  }),
};

export { AppleDeviceMutation };
