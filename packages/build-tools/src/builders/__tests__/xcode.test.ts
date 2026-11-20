import { BuildMode, Ios } from '@expo/eas-build-job';
import { BuildStepGlobalContext } from '@expo/steps';
import { vol } from 'memfs';

import { createTestBuildContext } from '../../__tests__/utils/context';
import { createTestXcodeJob, createTestXcodeSimulatorJob } from '../../__tests__/utils/job';
import { prepareProjectSourcesAsync } from '../../common/projectSources';
import { CustomBuildContext } from '../../customBuildContext';
import { findAndUploadXcodeBuildLogsAsync } from '../../ios/xcodeBuildLogs';
import { createXcodeWorkflowAsync, runXcodeBuildAsync, validateXcodeJob } from '../xcode';

jest.mock('../../common/projectSources');
jest.mock('../../ios/xcodeBuildLogs');

async function createWorkflowAsync(job: Ios.Job): ReturnType<typeof createXcodeWorkflowAsync> {
  const customBuildCtx = new CustomBuildContext(createTestBuildContext(job));
  return await createXcodeWorkflowAsync(
    new BuildStepGlobalContext(customBuildCtx, false),
    customBuildCtx
  );
}

afterEach(() => {
  vol.reset();
});

describe(validateXcodeJob, () => {
  it('accepts a device job, and keys the schema does not know', () => {
    expect(() => validateXcodeJob(createTestXcodeJob({ keyFromANewerServer: true }))).not.toThrow();
  });

  it('accepts a simulator job without an app identifier', () => {
    expect(() => validateXcodeJob(createTestXcodeSimulatorJob())).not.toThrow();
  });

  it.each([
    ['an unknown builder', { builder: 'unknown' }, '"builder" must be [xcode]'],
    ['a mode other than build', { mode: BuildMode.CUSTOM }, '"mode" must be [build]'],
    ['a field native jobs do not read', { buildProfile: 'production' }, '"buildProfile"'],
    ['a value of another type', { simulator: 'false' }, '"simulator" must be a boolean'],
    [
      'no app identifier for a device build',
      { appIdentifier: undefined },
      '"appIdentifier" is required',
    ],
    [
      'no distribution for a device build',
      { distribution: undefined },
      '"distribution" is required',
    ],
  ])('rejects a job with %s', (_description, overrides, expectedMessage) => {
    expect(() => validateXcodeJob(createTestXcodeJob(overrides))).toThrow(
      expect.objectContaining({
        trackingCode: 'NATIVE_INVALID_JOB',
        message: expect.stringContaining(expectedMessage),
      })
    );
  });
});

describe(createXcodeWorkflowAsync, () => {
  it('builds a valid workflow from the public and the private functions', async () => {
    const workflow = await createWorkflowAsync(createTestXcodeJob());

    expect(workflow.buildSteps.map(step => step.__metricsId)).toEqual([
      'eas/checkout',
      'eas/install_native_pods',
      'eas/detect_native_xcode',
      'eas/prepare_ios_credentials',
      'eas/configure_xcode_signing',
      'eas/build_native_ios',
      'eas/verify_native_ios',
      'eas/update_resolved_version',
      'eas/upload_artifact',
    ]);
  });

  it('leaves the credentials and the signing steps out of a simulator build', async () => {
    const workflow = await createWorkflowAsync(createTestXcodeSimulatorJob());

    expect(workflow.buildSteps.map(step => step.__metricsId)).toEqual([
      'eas/checkout',
      'eas/install_native_pods',
      'eas/detect_native_xcode',
      'eas/build_native_ios',
      'eas/verify_native_ios',
      'eas/update_resolved_version',
      'eas/upload_artifact',
    ]);
    const buildStep = workflow.buildSteps.find(
      step => step.__metricsId === 'eas/build_native_ios'
    )!;
    for (const inputId of ['installed_credentials', 'entitlements_path']) {
      expect(buildStep.inputs!.find(input => input.id === inputId)!.rawValue).toBeUndefined();
    }
  });

  it('passes the distribution of the job to the credentials step, and what that step installed to signing and the build', async () => {
    const workflow = await createWorkflowAsync(
      createTestXcodeJob({ distribution: 'internal', enterpriseProvisioning: 'universal' })
    );

    const rawInputsOf = (metricsId: string): Record<string, unknown> =>
      Object.fromEntries(
        (workflow.buildSteps.find(step => step.__metricsId === metricsId)!.inputs ?? []).map(
          input => [input.id, input.rawValue]
        )
      );
    expect(rawInputsOf('eas/prepare_ios_credentials')).toEqual({
      targets: '${{ steps.detect_native_xcode.outputs.targets }}',
      distribution: 'internal',
      enterprise_provisioning: 'universal',
    });
    const installedCredentials =
      '${{ steps.prepare_ios_credentials.outputs.installed_credentials }}';
    expect(rawInputsOf('eas/configure_xcode_signing')).toMatchObject({
      installed_credentials: installedCredentials,
    });
    expect(rawInputsOf('eas/build_native_ios')).toMatchObject({
      installed_credentials: installedCredentials,
      entitlements_path: '${{ steps.configure_xcode_signing.outputs.entitlements_path }}',
    });
  });

  it('passes the values known from the job to detection and verification', async () => {
    const workflow = await createWorkflowAsync(
      createTestXcodeJob({
        projectFile: 'App.xcworkspace',
        scheme: 'App',
        buildConfiguration: 'Staging',
      })
    );

    const rawInputsByMetricsId = Object.fromEntries(
      workflow.buildSteps.map(step => [
        step.__metricsId,
        Object.fromEntries((step.inputs ?? []).map(input => [input.id, input.rawValue])),
      ])
    );
    expect(rawInputsByMetricsId['eas/detect_native_xcode']).toEqual({
      project_file: 'App.xcworkspace',
      scheme: 'App',
      build_configuration: 'Staging',
      expected_identifier: 'dev.expo.nativeapp',
    });
    expect(rawInputsByMetricsId['eas/verify_native_ios']).toMatchObject({
      expected_identifier: 'dev.expo.nativeapp',
    });
  });

  it.each([
    {
      projectRootDirectory: '.',
      projectDirectory: undefined,
      projectRoot: '/workingdir/build',
      xcodeDirectory: '/workingdir/build',
    },
    {
      projectRootDirectory: '.',
      projectDirectory: 'ios',
      projectRoot: '/workingdir/build',
      xcodeDirectory: '/workingdir/build/ios',
    },
    {
      projectRootDirectory: '/',
      projectDirectory: 'ios',
      projectRoot: '/workingdir/build/',
      xcodeDirectory: '/workingdir/build/ios',
    },
    {
      projectRootDirectory: '/apps/mobile',
      projectDirectory: undefined,
      projectRoot: '/workingdir/build/apps/mobile',
      xcodeDirectory: '/workingdir/build/apps/mobile',
    },
    {
      projectRootDirectory: '/apps/mobile',
      projectDirectory: './ios',
      projectRoot: '/workingdir/build/apps/mobile',
      xcodeDirectory: '/workingdir/build/apps/mobile/ios',
    },
    {
      projectRootDirectory: '/apps/mobile',
      projectDirectory: '/native/ios',
      projectRoot: '/workingdir/build/apps/mobile',
      xcodeDirectory: '/workingdir/build/native/ios',
    },
    {
      projectRootDirectory: '/apps/mobile',
      projectDirectory: 'apps/mobile/ios',
      projectRoot: '/workingdir/build/apps/mobile',
      xcodeDirectory: '/workingdir/build/apps/mobile/apps/mobile/ios',
    },
  ])(
    'runs pod install, detection and the build in $xcodeDirectory, and the other steps and the hook steps in $projectRoot (projectRootDirectory: $projectRootDirectory, projectDirectory: $projectDirectory)',
    async ({ projectRootDirectory, projectDirectory, projectRoot, xcodeDirectory }) => {
      const workflow = await createWorkflowAsync(
        createTestXcodeJob({
          projectRootDirectory,
          projectDirectory,
          hooks: { after_checkout: [{ run: 'git submodule update --init' }] },
        })
      );
      const [checkoutStep] = workflow.buildSteps;
      checkoutStep.ctx.global.markAsCheckedOut();

      expect(
        Object.fromEntries(
          workflow.buildSteps.map(step => [step.__metricsId, step.ctx.workingDirectory])
        )
      ).toEqual({
        'eas/checkout': projectRoot,
        'eas/install_native_pods': xcodeDirectory,
        'eas/detect_native_xcode': xcodeDirectory,
        'eas/prepare_ios_credentials': projectRoot,
        'eas/configure_xcode_signing': projectRoot,
        'eas/build_native_ios': xcodeDirectory,
        'eas/verify_native_ios': projectRoot,
        'eas/update_resolved_version': projectRoot,
        'eas/upload_artifact': projectRoot,
      });
      expect(
        workflow.hooksByAnchorStep
          .get(checkoutStep)!
          .after.flatMap(({ steps }) => steps.map(step => step.ctx.workingDirectory))
      ).toEqual([projectRoot]);
    }
  );

  it('loads a local function that a hook step uses from the project root', async () => {
    vol.fromJSON(
      {
        '.eas/functions/setup/function.yml': `
        name: Setup
        runs:
          steps:
            - run: ./setup.sh
        `,
      },
      '/workingdir/temporary-custom-build/apps/mobile'
    );

    const workflow = await createWorkflowAsync(
      createTestXcodeJob({
        projectRootDirectory: '/apps/mobile',
        projectDirectory: 'ios',
        hooks: { after_checkout: [{ uses: './.eas/functions/setup' }] },
      })
    );

    const [checkoutStep] = workflow.buildSteps;
    expect(workflow.hooksByAnchorStep.get(checkoutStep)!.after).toHaveLength(1);
  });

  it('runs the after_checkout hook of the job after the checkout step', async () => {
    const workflow = await createWorkflowAsync(
      createTestXcodeJob({ hooks: { after_checkout: [{ run: 'git submodule update --init' }] } })
    );

    const checkoutStep = workflow.buildSteps.find(step => step.__metricsId === 'eas/checkout')!;
    expect(workflow.hooksByAnchorStep.get(checkoutStep)).toMatchObject({
      anchor: 'checkout',
      before: [],
      after: [expect.anything()],
    });
  });
});

describe(runXcodeBuildAsync, () => {
  it('validates the job before it prepares the project', async () => {
    const ctx = createTestBuildContext(createTestXcodeJob({ builder: 'unknown' }));

    await expect(runXcodeBuildAsync(ctx)).rejects.toMatchObject({
      trackingCode: 'NATIVE_INVALID_JOB',
    });
    expect(prepareProjectSourcesAsync).not.toHaveBeenCalled();
  });

  it('logs each reason when the hooks of the job make the workflow invalid', async () => {
    vol.mkdirSync('/workingdir/env', { recursive: true });
    const ctx = createTestBuildContext(
      createTestXcodeSimulatorJob({
        hooks: {
          after_checkout: [
            { id: 'same', run: 'echo first' },
            { id: 'same', run: 'echo second' },
          ],
        },
      })
    );

    await expect(runXcodeBuildAsync(ctx)).rejects.toThrow('Build workflow is invalid.');
    expect(ctx.logger.error).toHaveBeenCalledWith({
      err: expect.objectContaining({ message: 'Duplicated step IDs: "same"' }),
    });
  });

  it('runs the steps, uploads the Xcode logs once and attaches the artifacts to a failure', async () => {
    jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
      vol.mkdirSync('/workingdir/env', { recursive: true });
      vol.fromJSON({ 'README.md': '' }, '/workingdir/temporary-custom-build');
      return { handled: true };
    });
    const ctx = createTestBuildContext(createTestXcodeSimulatorJob());

    await expect(runXcodeBuildAsync(ctx)).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
      artifacts: ctx.artifacts,
    });
    expect(vol.existsSync('/workingdir/build/README.md')).toBe(true);
    expect(findAndUploadXcodeBuildLogsAsync).toHaveBeenCalledTimes(1);
  });
});
