import { Platform, Workflow } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { resolveVcsClient } from '../../vcs';
import { resolveWorkflowAsync, resolveWorkflowPerPlatformAsync } from '../workflow';

jest.mock('fs');

const projectDir = '/app';
const vcsClient = resolveVcsClient();

describe(resolveWorkflowAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  test('bare workflow for both platforms', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
        './android/app/src/main/AndroidManifest.xml': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient)).resolves.toBe(
      Workflow.GENERIC
    );
    await expect(resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient)).resolves.toBe(
      Workflow.GENERIC
    );
  });

  test('bare workflow for single platform', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient)).resolves.toBe(
      Workflow.MANAGED
    );
    await expect(resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient)).resolves.toBe(
      Workflow.GENERIC
    );
  });

  test('android/ios directories are ignored', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
        './android/app/src/main/AndroidManifest.xml': 'fake',
        './.easignore': 'android/\nios/',
      },
      projectDir
    );

    await expect(resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient)).resolves.toBe(
      Workflow.MANAGED
    );
    await expect(resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient)).resolves.toBe(
      Workflow.MANAGED
    );
  });
});

describe(resolveWorkflowPerPlatformAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  test('returns the correct combined value', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
        './android/app/src/main/AndroidManifest.xml': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflowPerPlatformAsync(projectDir, vcsClient)).resolves.toEqual({
      android: Workflow.GENERIC,
      ios: Workflow.GENERIC,
    });
  });
});
