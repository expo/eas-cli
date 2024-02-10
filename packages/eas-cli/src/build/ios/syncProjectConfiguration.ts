import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { IosVersionAutoIncrement } from '@expo/eas-json';

import { BumpStrategy, bumpVersionAsync, bumpVersionInAppJsonAsync } from './version';
import { Target } from '../../credentials/ios/types';
import { isExpoUpdatesInstalled } from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';
import { syncUpdatesConfigurationAsync } from '../../update/ios/UpdatesModule';
import { Client } from '../../vcs/vcs';

export async function syncProjectConfigurationAsync({
  projectDir,
  exp,
  targets,
  localAutoIncrement,
  vcsClient,
}: {
  projectDir: string;
  exp: ExpoConfig;
  targets: Target[];
  localAutoIncrement?: IosVersionAutoIncrement;
  vcsClient: Client;
}): Promise<void> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient, {
    useEASIgnoreIfAvailableWhenEvaluatingFileIgnores: true,
  });
  const versionBumpStrategy = resolveVersionBumpStrategy(localAutoIncrement ?? false);

  if (workflow === Workflow.GENERIC) {
    if (isExpoUpdatesInstalled(projectDir)) {
      await syncUpdatesConfigurationAsync(vcsClient, projectDir, exp);
    }
    await bumpVersionAsync({ projectDir, exp, bumpStrategy: versionBumpStrategy, targets });
  } else {
    await bumpVersionInAppJsonAsync({ projectDir, exp, bumpStrategy: versionBumpStrategy });
  }
}

function resolveVersionBumpStrategy(autoIncrement: IosVersionAutoIncrement): BumpStrategy {
  if (autoIncrement === true) {
    return BumpStrategy.BUILD_NUMBER;
  } else if (autoIncrement === false) {
    return BumpStrategy.NOOP;
  } else if (autoIncrement === 'buildNumber') {
    return BumpStrategy.BUILD_NUMBER;
  } else {
    return BumpStrategy.APP_VERSION;
  }
}
