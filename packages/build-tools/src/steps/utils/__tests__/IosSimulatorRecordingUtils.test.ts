import { type IosSimulatorUuid } from '../../../utils/IosSimulatorUtils';
import { createRecordSimArgs } from '../IosSimulatorRecordingUtils';

describe(createRecordSimArgs, () => {
  it('limits single-file recordings to 5 Mbps', () => {
    expect(
      createRecordSimArgs({
        udid: '00000000-0000-0000-0000-000000000000' as IosSimulatorUuid,
        outputDirectory: '/tmp/recording',
      })
    ).toEqual([
      '--udid',
      '00000000-0000-0000-0000-000000000000',
      '--output',
      '/tmp/recording',
      '--segment-duration',
      '0',
      '--bitrate',
      '5000000',
    ]);
  });
});
