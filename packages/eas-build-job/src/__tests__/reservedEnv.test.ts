import {
  findReservedEasBuildEnvironmentVariablesInWorkflow,
  formatReservedEasBuildEnvironmentVariableWarning,
  isReservedEasBuildEnvironmentVariableName,
  reservedEasBuildEnvironmentVariableNames,
} from '../reservedEnv';

describe(isReservedEasBuildEnvironmentVariableName, () => {
  it.each(['EAS_BUILD', 'EAS_BUILD_ID', 'EAS_BUILD_PLATFORM', 'EAS_BUILD_GIT_COMMIT_HASH'])(
    'treats %s as reserved',
    name => {
      expect(isReservedEasBuildEnvironmentVariableName(name)).toBe(true);
    }
  );

  it.each(['CI', 'EXPO_TOKEN', 'MY_BUILD_ID', 'EAS_USE_CACHE'])(
    'does not treat %s as reserved',
    name => {
      expect(isReservedEasBuildEnvironmentVariableName(name)).toBe(false);
    }
  );
});

describe(reservedEasBuildEnvironmentVariableNames, () => {
  it('returns sorted reserved keys from an env map', () => {
    expect(
      reservedEasBuildEnvironmentVariableNames({
        MY_BUILD_ID: 'abc',
        EAS_BUILD_ID: 'job-id',
        EAS_BUILD: 'true',
      })
    ).toEqual(['EAS_BUILD', 'EAS_BUILD_ID']);
  });

  it('returns an empty list for missing env', () => {
    expect(reservedEasBuildEnvironmentVariableNames(undefined)).toEqual([]);
  });
});

describe(findReservedEasBuildEnvironmentVariablesInWorkflow, () => {
  it('finds reserved names on defaults, jobs, steps, and hooks', () => {
    expect(
      findReservedEasBuildEnvironmentVariablesInWorkflow({
        defaults: { env: { EAS_BUILD: 'true' } },
        jobs: {
          custom_job: {
            env: { EAS_BUILD_ID: '${{ needs.repack.outputs.build_id }}' },
            steps: [{ run: 'echo hi', env: { EAS_BUILD_PLATFORM: 'ios' } }],
            hooks: {
              after_checkout: [{ run: 'echo', env: { EAS_BUILD_WORKINGDIR: '/tmp' } }],
            },
          },
          fingerprint: {
            env: { EXPO_PUBLIC_APP_ENV: 'STAGING' },
          },
        },
      })
    ).toEqual([
      { jobId: '(defaults)', path: 'defaults.env', names: ['EAS_BUILD'] },
      {
        jobId: 'custom_job',
        path: 'jobs.custom_job.env',
        names: ['EAS_BUILD_ID'],
      },
      {
        jobId: 'custom_job',
        path: 'jobs.custom_job.steps[0].env',
        names: ['EAS_BUILD_PLATFORM'],
      },
      {
        jobId: 'custom_job',
        path: 'jobs.custom_job.hooks.after_checkout[0].env',
        names: ['EAS_BUILD_WORKINGDIR'],
      },
    ]);
  });

  it('returns nothing for an empty workflow', () => {
    expect(findReservedEasBuildEnvironmentVariablesInWorkflow({})).toEqual([]);
  });
});

describe(formatReservedEasBuildEnvironmentVariableWarning, () => {
  it('returns null when nothing is reserved', () => {
    expect(formatReservedEasBuildEnvironmentVariableWarning([])).toBeNull();
  });

  it('lists each reserved usage and links to the docs', () => {
    const message = formatReservedEasBuildEnvironmentVariableWarning([
      {
        jobId: 'custom_job',
        path: 'jobs.custom_job.env',
        names: ['EAS_BUILD_ID'],
      },
    ]);
    expect(message).toContain('jobs.custom_job.env: EAS_BUILD_ID');
    expect(message).toContain('EAS_BUILD_ID');
    expect(message).toContain('https://docs.expo.dev/eas/environment-variables/usage/');
  });
});
