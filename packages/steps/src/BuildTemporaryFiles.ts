import path from 'path';
import fs from 'fs/promises';

import { v4 as uuidv4 } from 'uuid';

import { BuildStepGlobalContext } from './BuildStepContext';

export async function saveScriptToTemporaryFileAsync(
  ctx: BuildStepGlobalContext,
  stepId: string,
  scriptContents: string
): Promise<string> {
  const scriptsDir = getTemporaryScriptsDirPath(ctx, stepId);
  await fs.mkdir(scriptsDir, { recursive: true });
  const temporaryScriptPath = path.join(scriptsDir, `${uuidv4()}.sh`);
  await fs.writeFile(temporaryScriptPath, scriptContents);
  return temporaryScriptPath;
}

export async function cleanUpStepTemporaryDirectoriesAsync(
  ctx: BuildStepGlobalContext,
  stepId: string
): Promise<void> {
  if (ctx.skipCleanup) {
    return;
  }
  const stepTemporaryDirectory = getTemporaryStepDirPath(ctx, stepId);
  await fs.rm(stepTemporaryDirectory, { recursive: true, force: true });
  ctx.baseLogger.debug({ stepTemporaryDirectory }, 'Removed step temporary directory');
}

function getTemporaryStepDirPath(ctx: BuildStepGlobalContext, stepId: string): string {
  return path.join(ctx.stepsInternalBuildDirectory, 'steps', stepId);
}

function getTemporaryScriptsDirPath(ctx: BuildStepGlobalContext, stepId: string): string {
  return path.join(getTemporaryStepDirPath(ctx, stepId), 'scripts');
}

export function getTemporaryOutputsDirPath(ctx: BuildStepGlobalContext, stepId: string): string {
  return path.join(getTemporaryStepDirPath(ctx, stepId), 'outputs');
}

export function getTemporaryEnvsDirPath(ctx: BuildStepGlobalContext, stepId: string): string {
  return path.join(getTemporaryStepDirPath(ctx, stepId), 'envs');
}
