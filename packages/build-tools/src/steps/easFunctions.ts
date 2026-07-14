import { BuildFunction } from '@expo/steps';

import { calculateEASUpdateRuntimeVersionFunction } from './functions/calculateEASUpdateRuntimeVersion';
import { createCapturePosthogEventFunction } from './functions/capturePosthogEvent';
import { createCheckoutBuildFunction } from './functions/checkout';
import { configureAndroidVersionFunction } from './functions/configureAndroidVersion';
import { configureEASUpdateIfInstalledFunction } from './functions/configureEASUpdateIfInstalled';
import { configureIosCredentialsFunction } from './functions/configureIosCredentials';
import { configureIosVersionFunction } from './functions/configureIosVersion';
import { createSubmissionEntityFunction } from './functions/createSubmissionEntity';
import { createDownloadArtifactFunction } from './functions/downloadArtifact';
import { createDownloadBuildFunction } from './functions/downloadBuild';
import { createEasDeployBuildFunction } from './functions/deploy';
import { createEasExportBuildFunction } from './functions/export';
import { eagerBundleBuildFunction } from './functions/eagerBundle';
import { createFindAndUploadBuildArtifactsBuildFunction } from './functions/findAndUploadBuildArtifacts';
import { createFinishIosSimulatorRecordingsBuildFunction } from './functions/finishIosSimulatorRecordings';
import { generateGymfileFromTemplateFunction } from './functions/generateGymfileFromTemplate';
import { createGetCredentialsForBuildTriggeredByGithubIntegration } from './functions/getCredentialsForBuildTriggeredByGitHubIntegration';
import { injectAndroidCredentialsFunction } from './functions/injectAndroidCredentials';
import { createInstallMaestroBuildFunction } from './functions/installMaestro';
import { createInstallNodeModulesBuildFunction } from './functions/installNodeModules';
import { createInstallPodsBuildFunction } from './functions/installPods';
import { createPrebuildBuildFunction } from './functions/prebuild';
import { createReadAppConfigBuildFunction } from './functions/readAppConfig';
import { createReadIpaInfoBuildFunction } from './functions/readIpaInfo';
import { createReadPackageJsonBuildFunction } from './functions/readPackageJson';
import { createRepackBuildFunction } from './functions/repack';
import { createReportMaestroTestResultsFunction } from './functions/reportMaestroTestResults';
import { resolveAppleTeamIdFromCredentialsFunction } from './functions/resolveAppleTeamIdFromCredentials';
import { createResolveBuildConfigBuildFunction } from './functions/resolveBuildConfig';
import {
  createCacheStatsBuildFunction,
  createRestoreBuildCacheFunction,
} from './functions/restoreBuildCache';
import { createRestoreCacheFunction } from './functions/restoreCache';
import { parseXcactivitylogFunction } from './functions/parseXcactivitylog';
import { runFastlaneFunction } from './functions/runFastlane';
import { runGradleFunction } from './functions/runGradle';
import { createMaestroTestsBuildFunction } from './functions/maestroTests';
import { createSaveBuildCacheFunction } from './functions/saveBuildCache';
import { createRolloutPosthogFlagFunction } from './functions/rolloutPosthogFlag';
import { createSaveCacheFunction } from './functions/saveCache';
import { createSendSlackMessageFunction } from './functions/sendSlackMessage';
import { createStartAgentDeviceRemoteSessionBuildFunction } from './functions/startAgentDeviceRemoteSession';
import { createStartAndroidEmulatorBuildFunction } from './functions/startAndroidEmulator';
import { createStartArgentRemoteSessionBuildFunction } from './functions/startArgentRemoteSession';
import { createStartCuttlefishDeviceBuildFunction } from './functions/startCuttlefishDevice';
import { createStartIosSimulatorBuildFunction } from './functions/startIosSimulator';
import { createStartIosSimulatorRecordingsBuildFunction } from './functions/startIosSimulatorRecordings';
import { createStartServeSimRemoteSessionBuildFunction } from './functions/startServeSimRemoteSession';
import { createUploadArtifactBuildFunction } from './functions/uploadArtifact';
import { createUploadDeviceRunSessionScreenRecordingsBuildFunction } from './functions/uploadDeviceRunSessionScreenRecordings';
import { createUploadToAscBuildFunction } from './functions/uploadToAsc';
import { createSetUpNpmrcBuildFunction } from './functions/useNpmToken';
import { createWaitForPosthogMetricFunction } from './functions/waitForPosthogMetric';
import { createUploadPosthogSourcemapsFunction } from './functions/uploadPosthogSourcemaps';
import { createPosthogAnnotationFunction } from './functions/createPosthogAnnotation';
import { createWaitForPosthogQueryFunction } from './functions/waitForPosthogQuery';
import { CustomBuildContext } from '../customBuildContext';

export function getEasFunctions(ctx: CustomBuildContext): BuildFunction[] {
  const functions = [
    createCheckoutBuildFunction(),
    createDownloadArtifactFunction(),
    createUploadArtifactBuildFunction(ctx),
    createSetUpNpmrcBuildFunction(),
    createReadPackageJsonBuildFunction(),
    createReadAppConfigBuildFunction(),
    createInstallNodeModulesBuildFunction(),
    createPrebuildBuildFunction(),
    createReadIpaInfoBuildFunction(),
    createDownloadBuildFunction(ctx),
    createEasExportBuildFunction(),
    createEasDeployBuildFunction(),
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
    parseXcactivitylogFunction(),
    createStartAgentDeviceRemoteSessionBuildFunction(ctx),
    createStartArgentRemoteSessionBuildFunction(ctx),
    createStartAndroidEmulatorBuildFunction(),
    createStartCuttlefishDeviceBuildFunction(),
    createStartIosSimulatorBuildFunction(),
    createStartIosSimulatorRecordingsBuildFunction(),
    createFinishIosSimulatorRecordingsBuildFunction(),
    createUploadDeviceRunSessionScreenRecordingsBuildFunction(ctx),
    createStartServeSimRemoteSessionBuildFunction(ctx),
    createInstallMaestroBuildFunction(),

    createInstallPodsBuildFunction(),
    createSendSlackMessageFunction(),
    createCapturePosthogEventFunction(),
    createRolloutPosthogFlagFunction(),
    createWaitForPosthogMetricFunction(),
    createUploadPosthogSourcemapsFunction(),
    createPosthogAnnotationFunction(),
    createWaitForPosthogQueryFunction(),

    calculateEASUpdateRuntimeVersionFunction(),

    createSubmissionEntityFunction(),
    createUploadToAscBuildFunction(),

    createReportMaestroTestResultsFunction(ctx),
    createMaestroTestsBuildFunction(ctx),
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
