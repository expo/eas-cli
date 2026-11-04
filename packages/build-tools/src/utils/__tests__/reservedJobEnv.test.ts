import { UserError } from '@expo/eas-build-job';

import { createMockLogger } from '../../__tests__/utils/logger';
import { warnOrThrowIfJobOverridesReservedEnvironmentVariables } from '../reservedJobEnv';

describe(warnOrThrowIfJobOverridesReservedEnvironmentVariables, () => {
  it('does nothing when the job does not set reserved names', () => {
    const logger = createMockLogger();
    expect(() =>
      warnOrThrowIfJobOverridesReservedEnvironmentVariables({
        jobEnv: { MY_BUILD_ID: 'build-from-repack' },
        workerEnv: { EAS_BUILD_ID: 'job-run-id' },
        logger,
      })
    ).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when a reserved name is set to the same value the worker would use', () => {
    const logger = createMockLogger();
    expect(() =>
      warnOrThrowIfJobOverridesReservedEnvironmentVariables({
        jobEnv: { EAS_BUILD_ID: 'job-run-id' },
        workerEnv: { EAS_BUILD_ID: 'job-run-id' },
        logger,
      })
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('EAS_BUILD_ID'));
  });

  it('throws when EAS_BUILD_ID is overwritten with a different value', () => {
    const logger = createMockLogger();
    try {
      warnOrThrowIfJobOverridesReservedEnvironmentVariables({
        jobEnv: { EAS_BUILD_ID: 'repack-build-id' },
        workerEnv: { EAS_BUILD_ID: 'job-run-id' },
        logger,
      });
      throw new Error('expected UserError');
    } catch (error) {
      expect(error).toBeInstanceOf(UserError);
      expect((error as UserError).errorCode).toBe('EAS_RESERVED_ENV_EAS_BUILD_ID');
      expect((error as Error).message).toContain('repack-build-id');
    }
    expect(logger.warn).toHaveBeenCalled();
  });
});
