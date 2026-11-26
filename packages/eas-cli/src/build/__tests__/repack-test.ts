import * as YAML from 'yaml';

import { REPACK_JOB_KEY, createRepackWorkflowYamlConfig } from '../repack';

describe(createRepackWorkflowYamlConfig, () => {
  it('creates a single repack job with only the build ID by default', () => {
    const config = YAML.parse(createRepackWorkflowYamlConfig({ buildId: 'build-1' }));

    expect(Object.keys(config.jobs)).toEqual([REPACK_JOB_KEY]);
    expect(config.jobs[REPACK_JOB_KEY]).toEqual({
      name: 'Repack build',
      type: 'repack',
      params: { build_id: 'build-1' },
    });
  });

  it('passes all provided options as job params', () => {
    const config = YAML.parse(
      createRepackWorkflowYamlConfig({
        buildId: 'build-1',
        profile: 'preview',
        embedBundleAssets: false,
        jsBundleOnly: true,
        iosSigningBackend: 'zsign',
        message: 'Fix: typo',
      })
    );

    expect(config.jobs[REPACK_JOB_KEY].params).toEqual({
      build_id: 'build-1',
      profile: 'preview',
      embed_bundle_assets: false,
      js_bundle_only: true,
      ios_signing_backend: 'zsign',
      message: 'Fix: typo',
    });
  });
});
