import { BuildFunction } from '@expo/steps';

import { calculateEASUpdateRuntimeVersionFunction } from './functions/calculateEASUpdateRuntimeVersion';
import { createCheckoutBuildFunction } from './functions/checkout';
import { configureAndroidVersionFunction } from './functions/configureAndroidVersion';
import { configureEASUpdateIfInstalledFunction } from './functions/configureEASUpdateIfInstalled';
import { configureIosCredentialsFunction } from './functions/configureIosCredentials';
import { configureIosVersionFunction } from './functions/configureIosVersion';
import { createSubmissionEntityFunction } from './functions/createSubmissionEntity';
import { createDownloadArtifactFunction } from './functions/downloadArtifact';
import { createDownloadBuildFunction } from './functions/downloadBuild';
import { eagerBundleBuildFunction } from './functions/eagerBundle';
import { createFindAndUploadBuildArtifactsBuildFunction } from './functions/findAndUploadBuildArtifacts';
import { generateGymfileFromTemplateFunction } from './functions/generateGymfileFromTemplate';
import { createGetCredentialsForBuildTriggeredByGithubIntegration } from './functions/getCredentialsForBuildTriggeredByGitHubIntegration';
import { injectAndroidCredentialsFunction } from './functions/injectAndroidCredentials';
import { createInstallMaestroBuildFunction } from './functions/installMaestro';
import { createInstallNodeModulesBuildFunction } from './functions/installNodeModules';
import { createInstallPodsBuildFunction } from './functions/installPods';
import { createInternalEasMaestroTestFunction } from './functions/internalMaestroTest';
import { createPrebuildBuildFunction } from './functions/prebuild';
import { createRepackBuildFunction } from './functions/repack';
import { createReportMaestroTestResultsFunction } from './functions/reportMaestroTestResults';
import { resolveAppleTeamIdFromCredentialsFunction } from './functions/resolveAppleTeamIdFromCredentials';
import { createResolveBuildConfigBuildFunction } from './functions/resolveBuildConfig';
import {
  createCacheStatsBuildFunction,
  createRestoreBuildCacheFunction,
} from './functions/restoreBuildCache';
import { createRestoreCacheFunction } from './functions/restoreCache';
import { runFastlaneFunction } from './functions/runFastlane';
import { runGradleFunction } from './functions/runGradle';
import { createSaveBuildCacheFunction } from './functions/saveBuildCache';
import { createSaveCacheFunction } from './functions/saveCache';
import { createSendSlackMessageFunction } from './functions/sendSlackMessage';
import { createStartAndroidEmulatorBuildFunction } from './functions/startAndroidEmulator';
import { createStartCuttlefishDeviceBuildFunction } from './functions/startCuttlefishDevice';
import { createStartIosSimulatorBuildFunction } from './functions/startIosSimulator';
import { createUploadArtifactBuildFunction } from './functions/uploadArtifact';
import { createUploadToAscBuildFunction } from './functions/uploadToAsc';
import { createSetUpNpmrcBuildFunction } from './functions/useNpmToken';
import { CustomBuildContext } from '../customBuildContext';

export function getEasFunctions(ctx: CustomBuildContext): BuildFunction[] {
  const functions = [
    createCheckoutBuildFunction(),
    createDownloadArtifactFunction(),
    createUploadArtifactBuildFunction(ctx),
    createSetUpNpmrcBuildFunction(),
    createInstallNodeModulesBuildFunction(),
    createPrebuildBuildFunction(),
    createDownloadBuildFunction(),
    createRepackBuildFunction(),
    createRestoreCacheFunction(),
    createRestoreBuildCacheFunction(),
    createSaveCacheFunction(),
    createSaveBuildCacheFunction(ctx.startTime),
    createCacheStatsBuildFunction(),
    configureEASUpdateIfInstalledFunction(),
    injectAndroidCredentialsFunction(),
    configureAndroidVersionFunction(),
    eagerBundleBuildFunction(),
    runGradleFunction(),
    resolveAppleTeamIdFromCredentialsFunction(),
    configureIosCredentialsFunction(),
    configureIosVersionFunction(),
    generateGymfileFromTemplateFunction(),
    runFastlaneFunction(),
    createStartAndroidEmulatorBuildFunction(),
    createStartCuttlefishDeviceBuildFunction(),
    createStartIosSimulatorBuildFunction(),
    createInstallMaestroBuildFunction(),

    createInstallPodsBuildFunction(),
    createSendSlackMessageFunction(),

    calculateEASUpdateRuntimeVersionFunction(),

    createSubmissionEntityFunction(),
    createUploadToAscBuildFunction(),

    createInternalEasMaestroTestFunction(ctx),

    createReportMaestroTestResultsFunction(ctx),
  ];

  if (ctx.hasBuildJob()) {
    functions.push(
      ...[
        createFindAndUploadBuildArtifactsBuildFunction(ctx),
        createResolveBuildConfigBuildFunction(ctx),
        createGetCredentialsForBuildTriggeredByGithubIntegration(ctx),
      ]
    );
  }

  return functions;
}
