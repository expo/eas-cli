import { AppleDevice } from '../../../types/credentials/AppleDevice';

const AppleDeviceMutation = {
  createAppleDeviceAsync: jest.fn().mockImplementation(() => {
    const appleDevice: AppleDevice = {
      id: 'apple-device-id',
      identifier: '00009999-000D6666146B888E',
    };
    return appleDevice;
  }),
};

export { AppleDeviceMutation };
