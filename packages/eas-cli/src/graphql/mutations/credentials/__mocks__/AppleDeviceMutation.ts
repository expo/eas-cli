import { AppleDevice } from '../../../types/credentials/AppleDevice';

const AppleDeviceMutation = {
  createAppleDeviceAsync: jest.fn().mockImplementation(() => {
    const appleDevice: AppleDevice = {
      id: 'apple-device-id',
    };
    return appleDevice;
  }),
};

export { AppleDeviceMutation };
