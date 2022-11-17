import { ProjectConfig, getConfig } from '@expo/config';

import { getExpoConfig } from '../expoConfig';

jest.mock('@expo/config');

describe(getExpoConfig, () => {
  it('correctly restores process.env as best as possible', () => {
    process.env.BEFORE_CALL_KEY = 'BEFORE';
    process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_WITHIN = 'BEFORE_OVERRIDDEN_BY_WITHIN';
    process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS = 'BEFORE_OVERRIDDEN_BY_OPTS';
    process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS_AND_WITHIN =
      'BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS_AND_WITHIN';

    jest.mocked(getConfig).mockImplementation(() => {
      process.env.WITHIN_CALL_KEY = 'WITHIN';
      process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_WITHIN = 'OVERRIDDEN_VALUE';
      process.env.OPTS_KEY_OVERRIDDEN_BY_WITHIN = 'OVERRIDDEN_VALUE';
      process.env.OPTS_KEY_OVERRIDDEN_BY_WITHIN_TO_SAME_VALUE =
        'OPTS_KEY_OVERRIDDEN_BY_WITHIN_TO_SAME_VALUE';
      process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS_AND_WITHIN = 'OVERRIDDEN_WITHIN';
      return {} as ProjectConfig;
    });

    // ensure idempotent (run N times)
    for (let i = 0; i < 2; i++) {
      getExpoConfig('', {
        env: {
          OPTS_KEY: 'OPTS',
          BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS: 'OVERRIDDEN_VALUE',
          OPTS_KEY_OVERRIDDEN_BY_WITHIN: 'OPTS_KEY_OVERRIDDEN_BY_WITHIN',
          OPTS_KEY_OVERRIDDEN_BY_WITHIN_TO_SAME_VALUE:
            'OPTS_KEY_OVERRIDDEN_BY_WITHIN_TO_SAME_VALUE',
          BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS_AND_WITHIN: 'OVERRIDDEN_OPTS',
        },
      });

      // env from before the call should be restored
      expect(process.env.BEFORE_CALL_KEY).toEqual('BEFORE');

      // env from before the call but overridden within the call should not be restored
      expect(process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_WITHIN).toEqual('OVERRIDDEN_VALUE');

      // env from before the call but overridden by opts should be restored
      expect(process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS).toEqual('BEFORE_OVERRIDDEN_BY_OPTS');

      // env added within the call should be kept
      expect(process.env.WITHIN_CALL_KEY).toEqual('WITHIN');

      // env added by opts should be removed
      expect(process.env.OPTS_KEY).toBeUndefined();

      // env added by opts but overridden within the call should be retained and have overridden value
      expect(process.env.OPTS_KEY_OVERRIDDEN_BY_WITHIN).toEqual('OVERRIDDEN_VALUE');

      // env added by opts but overridden within the call to the same value will be removed
      // note that this is a known bug/limitation of this approach
      expect(process.env.OPTS_KEY_OVERRIDDEN_BY_WITHIN_TO_SAME_VALUE).toBeUndefined();

      // env from before but overridden within the call and by opts should retain value from
      // within the call
      expect(process.env.BEFORE_CALL_KEY_OVERRIDDEN_BY_OPTS_AND_WITHIN).toEqual(
        'OVERRIDDEN_WITHIN'
      );
    }
  });
});
