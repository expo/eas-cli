import { v4 as uuidv4 } from 'uuid';

import { AppleDeviceClass, AppleDeviceFragment } from '../../../../graphql/generated';
import { ApplePlatform } from '../../appstore/constants';
import { filterDevicesForApplePlatform, formatDeviceLabel } from '../DeviceUtils';

function createDevice(
  overrides: Partial<AppleDeviceFragment> & Pick<AppleDeviceFragment, 'identifier'>
): AppleDeviceFragment {
  return {
    __typename: 'AppleDevice',
    id: uuidv4(),
    name: 'device',
    model: null,
    deviceClass: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as AppleDeviceFragment;
}

describe(filterDevicesForApplePlatform, () => {
  const iphone = createDevice({
    identifier: 'iphone',
    deviceClass: AppleDeviceClass.Iphone,
  });
  const ipad = createDevice({
    identifier: 'ipad',
    deviceClass: AppleDeviceClass.Ipad,
  });
  const mac = createDevice({
    identifier: 'mac',
    deviceClass: AppleDeviceClass.Mac,
  });
  const appleTv = createDevice({
    identifier: 'appletv',
    model: 'AppleTV6,3',
    deviceClass: AppleDeviceClass.Unknown,
  });
  const unknown = createDevice({
    identifier: 'unknown',
    deviceClass: AppleDeviceClass.Unknown,
  });
  const noClass = createDevice({
    identifier: 'noclass',
    deviceClass: null,
  });

  it('keeps only iPhone and iPad devices for iOS targets', () => {
    expect(
      filterDevicesForApplePlatform(
        [iphone, ipad, mac, appleTv, unknown, noClass],
        ApplePlatform.IOS
      )
    ).toEqual([iphone, ipad]);
  });

  it('throws for tvOS targets', () => {
    expect(() =>
      filterDevicesForApplePlatform([iphone, ipad, mac, appleTv], ApplePlatform.TV_OS)
    ).toThrow('Filtering for tvOS is not supported yet');
  });
});

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
