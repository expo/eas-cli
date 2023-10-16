import { v4 as uuidv4 } from 'uuid';

import { AppleDeviceClass, AppleDeviceFragment } from '../../../../graphql/generated';
import { formatDeviceLabel } from '../DeviceUtils';

describe(formatDeviceLabel, () => {
  it('returns createdAt clause', async () => {
    const currentDate = new Date();
    const appleDevice = {
      __typename: 'AppleDevice',
      id: uuidv4(),
      identifier: 'test-apple-device-id',
      name: 'test-apple-device-name',
      model: '15',
      deviceClass: AppleDeviceClass.Iphone,
      createdAt: currentDate.toISOString(),
    } as AppleDeviceFragment;

    const result = formatDeviceLabel(appleDevice);

    expect(result).toEqual(
      `test-apple-device-id (iPhone 15) (test-apple-device-name) (created at: ${currentDate.toISOString()})`
    );
  });
});
