import { EasJsonUtils } from '@expo/eas-json';
import * as YAML from 'yaml';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { listAndSelectBuildOnAppAsync } from '../../../build/queries';
import { printBuildResults } from '../../../build/utils/printBuildInfo';
import { buildProfileNamesFromProjectAsync } from '../../../commandUtils/workflow/buildProfileUtils';
import { uploadWorkflowProjectSourceAsync } from '../../../commandUtils/workflow/projectSource';
import { showWorkflowStatusAsync } from '../../../commandUtils/workflow/utils';
import {
  AppPlatform,
  BuildStatus,
  StatuspageServiceName,
  WorkflowProjectSourceType,
  WorkflowRunStatus,
} from '../../../graphql/generated';
import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../../graphql/mutations/WorkflowRunMutation';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { WorkflowRunQuery } from '../../../graphql/queries/WorkflowRunQuery';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { maybeWarnAboutEasOutagesAsync } from '../../../utils/statuspageService';
import BuildRepack from '../repack';

jest.mock('../../../build/queries');
jest.mock('../../../build/utils/printBuildInfo');
jest.mock('../../../commandUtils/workflow/buildProfileUtils');
jest.mock('../../../commandUtils/workflow/projectSource');
jest.mock('../../../commandUtils/workflow/utils', () => ({
  ...jest.requireActual('../../../commandUtils/workflow/utils'),
  showWorkflowStatusAsync: jest.fn(),
}));
jest.mock('../../../graphql/mutations/WorkflowRevisionMutation');
jest.mock('../../../graphql/mutations/WorkflowRunMutation');
jest.mock('../../../graphql/queries/BuildQuery');
jest.mock('../../../graphql/queries/WorkflowRunQuery');
jest.mock('../../../project/projectUtils');
jest.mock('../../../utils/statuspageService');
jest.mock('../../../log');
jest.mock('@expo/eas-json', () => ({
  ...jest.requireActual('@expo/eas-json'),
  EasJsonUtils: { getBuildProfileAsync: jest.fn() },
}));

const projectSource = {
  type: WorkflowProjectSourceType.Gcs,
  projectArchiveBucketKey: 'archive-key',
  easJsonBucketKey: 'eas-json-key',
  packageJsonBucketKey: 'package-json-key',
  projectRootDirectory: '.',
};

function mockBuild(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'build-1',
    platform: AppPlatform.Ios,
    status: BuildStatus.Finished,
    app: { id: 'app-1' },
    artifacts: { applicationArchiveUrl: 'https://example.com/app.ipa' },
    ...overrides,
  };
}

describe(BuildRepack, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue({
      id: 'account-1',
      name: 'testuser',
    } as any);
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue(mockBuild());
    jest.mocked(WorkflowRevisionMutation.validateWorkflowYamlConfigAsync).mockResolvedValue();
    jest.mocked(uploadWorkflowProjectSourceAsync).mockResolvedValue(projectSource);
    jest.mocked(WorkflowRunMutation.createWorkflowRunAsync).mockResolvedValue({ id: 'run-1' });
    jest.mocked(buildProfileNamesFromProjectAsync).mockResolvedValue(new Set(['preview']));
    jest.mocked(EasJsonUtils.getBuildProfileAsync).mockResolvedValue({ env: {} } as any);
  });

  function createCommand(argv: string[]): BuildRepack {
    const command = new BuildRepack(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockResolvedValue({
      loggedIn: { actor: {}, graphqlClient: {} },
      getDynamicPrivateProjectConfigAsync: jest.fn().mockResolvedValue({
        projectId: 'app-1',
        exp: { slug: 'testapp' },
      }),
      projectDir: '/project',
      vcsClient: {},
    });
    return command;
  }

  function createdWorkflowYaml(): any {
    const [[, { workflowRevisionInput }]] = jest.mocked(WorkflowRunMutation.createWorkflowRunAsync)
      .mock.calls;
    return YAML.parse(workflowRevisionInput.yamlConfig);
  }

  it('starts a repack workflow for the given build and flags', async () => {
    await createCommand([
      '--id',
      'build-1',
      '--profile',
      'preview',
      '--no-embed-bundle-assets',
      '--ios-signing-backend',
      'zsign',
      '--message',
      'Hotfix',
      '--no-wait',
    ]).runAsync();

    expect(uploadWorkflowProjectSourceAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1', projectDir: '/project' })
    );
    expect(WorkflowRunMutation.createWorkflowRunAsync).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        appId: 'app-1',
        workflowRevisionInput: expect.objectContaining({ fileName: 'eas-build-repack.yml' }),
        workflowRunInput: { projectSource },
      })
    );
    expect(createdWorkflowYaml().jobs.repack).toEqual({
      name: 'Repack build',
      type: 'repack',
      params: {
        build_id: 'build-1',
        profile: 'preview',
        embed_bundle_assets: false,
        ios_signing_backend: 'zsign',
        message: 'Hotfix',
      },
    });
    expect(showWorkflowStatusAsync).not.toHaveBeenCalled();
  });

  it('prompts for a build when no ID is given', async () => {
    jest.mocked(listAndSelectBuildOnAppAsync).mockResolvedValue(mockBuild({ id: 'build-2' }));

    await createCommand(['--platform', 'ios', '--no-wait']).runAsync();

    expect(listAndSelectBuildOnAppAsync).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        projectId: 'app-1',
        filter: expect.objectContaining({
          platform: AppPlatform.Ios,
          status: BuildStatus.Finished,
        }),
      })
    );
    expect(createdWorkflowYaml().jobs.repack.params).toEqual({ build_id: 'build-2' });
  });

  it('waits for the workflow and prints the repacked build', async () => {
    const repackedBuild = mockBuild({ id: 'build-repacked' });
    jest
      .mocked(showWorkflowStatusAsync)
      .mockResolvedValue({ status: WorkflowRunStatus.Success } as any);
    jest.mocked(WorkflowRunQuery.withJobsByIdAsync).mockResolvedValue({
      jobs: [{ key: 'repack', turtleBuild: repackedBuild }],
    } as any);

    await createCommand(['--id', 'build-1']).runAsync();

    expect(printBuildResults).toHaveBeenCalledWith([repackedBuild]);
  });

  it('throws when the repack workflow fails', async () => {
    jest
      .mocked(showWorkflowStatusAsync)
      .mockResolvedValue({ status: WorkflowRunStatus.Failure } as any);
    jest.mocked(WorkflowRunQuery.withJobsByIdAsync).mockResolvedValue({ jobs: [] } as any);

    await expect(createCommand(['--id', 'build-1']).runAsync()).rejects.toThrow(
      'Repacking the build failed'
    );
    expect(printBuildResults).not.toHaveBeenCalled();
  });

  it('rejects builds from another project', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue(mockBuild({ app: { id: 'other-app' } }));

    await expect(createCommand(['--id', 'build-1']).runAsync()).rejects.toThrow(
      'does not belong to this project'
    );
    expect(WorkflowRunMutation.createWorkflowRunAsync).not.toHaveBeenCalled();
  });

  it('rejects builds that did not finish', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue(mockBuild({ status: BuildStatus.Errored }));

    await expect(createCommand(['--id', 'build-1']).runAsync()).rejects.toThrow(
      'Only builds that finished successfully can be repacked.'
    );
  });

  it('repacks an iOS simulator build with a simulator profile', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue(mockBuild({ isForIosSimulator: true }));
    jest
      .mocked(EasJsonUtils.getBuildProfileAsync)
      .mockResolvedValue({ simulator: true, env: {} } as any);

    await createCommand(['--id', 'build-1', '--no-wait']).runAsync();

    expect(WorkflowRunMutation.createWorkflowRunAsync).toHaveBeenCalled();
  });

  it('rejects a device profile for an iOS simulator build', async () => {
    jest.mocked(BuildQuery.byIdAsync).mockResolvedValue(mockBuild({ isForIosSimulator: true }));

    await expect(
      createCommand(['--id', 'build-1', '--profile', 'preview']).runAsync()
    ).rejects.toThrow(
      'Build with ID build-1 is an iOS simulator build, but build profile "preview" is for devices.'
    );
    expect(WorkflowRunMutation.createWorkflowRunAsync).not.toHaveBeenCalled();
  });

  it('rejects a simulator profile for an iOS device build', async () => {
    jest
      .mocked(EasJsonUtils.getBuildProfileAsync)
      .mockResolvedValue({ simulator: true, env: {} } as any);

    await expect(
      createCommand(['--id', 'build-1', '--profile', 'preview']).runAsync()
    ).rejects.toThrow(
      'Build with ID build-1 is an iOS device build, but build profile "preview" is for the simulator.'
    );
  });

  it('skips the profile check when the source build has no profile name', async () => {
    jest
      .mocked(BuildQuery.byIdAsync)
      .mockResolvedValue(mockBuild({ isForIosSimulator: true, buildProfile: null }));

    await createCommand(['--id', 'build-1', '--no-wait']).runAsync();

    expect(EasJsonUtils.getBuildProfileAsync).not.toHaveBeenCalled();
    expect(WorkflowRunMutation.createWorkflowRunAsync).toHaveBeenCalled();
  });

  it('checks the source build profile when --profile is not given', async () => {
    jest
      .mocked(BuildQuery.byIdAsync)
      .mockResolvedValue(mockBuild({ isForIosSimulator: true, buildProfile: 'preview' }));

    await expect(createCommand(['--id', 'build-1']).runAsync()).rejects.toThrow(
      'Build with ID build-1 is an iOS simulator build, but build profile "preview" is for devices.'
    );
  });

  it('warns about EAS outages before starting the workflow', async () => {
    await createCommand(['--id', 'build-1', '--no-wait']).runAsync();

    expect(maybeWarnAboutEasOutagesAsync).toHaveBeenCalledWith({}, [
      StatuspageServiceName.EasBuild,
      StatuspageServiceName.EasWorkflows,
    ]);
    expect(
      jest.mocked(maybeWarnAboutEasOutagesAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(WorkflowRunMutation.createWorkflowRunAsync).mock.invocationCallOrder[0]);
  });

  it('rejects a build profile missing from eas.json', async () => {
    await expect(
      createCommand(['--id', 'build-1', '--profile', 'missing']).runAsync()
    ).rejects.toThrow('There is no build profile named "missing" in eas.json.');
  });

  it('rejects --ios-signing-backend for Android builds', async () => {
    jest
      .mocked(BuildQuery.byIdAsync)
      .mockResolvedValue(mockBuild({ platform: AppPlatform.Android }));

    await expect(
      createCommand(['--id', 'build-1', '--ios-signing-backend', 'zsign']).runAsync()
    ).rejects.toThrow('can only be used with iOS builds');
  });

  it('requires --id in non-interactive mode', async () => {
    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      'is required when running with'
    );
  });
});
