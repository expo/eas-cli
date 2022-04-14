import { getConfig } from '@expo/config';
import admzip from 'adm-zip';
import fs from 'fs';
import fsPromise from 'fs/promises';
import got from 'got';
import fetch from 'node-fetch';
import path from 'path';
import { pipeline } from 'stream/promises';

import { makeZipAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { bundleFunctionsAsync, prepareFunctionEntriesAsync } from '../../functions/webpack';
import { FunctionMutation } from '../../graphql/mutations/FunctionMutation';
import { PresignedPost } from '../../graphql/mutations/UploadSessionMutation';
import Log from '../../log';
import { ora } from '../../ora';
import {
  findProjectRootAsync,
  getProjectAccountName,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { uploadWithPresignedPostAsync } from '../../uploads';
import { ensureLoggedInAsync } from '../../user/actions';
import { expoCommandAsync } from '../../utils/expoCli';
import { sleepAsync } from '../../utils/promise';

export default class FunctionsCreate extends EasCommand {
  static description = 'create a function';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    const downloadSpinner = ora('Downloading functions template...').start();
    const functionsTemplateUrl =
      'https://github.com/quinlanj/functions-entry-point/archive/refs/heads/main.zip';
    const functionsBuild = 'functions-build';
    const functionsBuildZip = `${functionsBuild}.zip`;
    const originalUnzippedDirectory = 'functions-entry-point-main';
    // ensure empty build directory
    await fsPromise.rm(path.join(projectDir, functionsBuild), { force: true, recursive: true });
    // download and unzip the functions template
    const downloadStream = got.stream(functionsTemplateUrl);
    await pipeline(downloadStream, fs.createWriteStream(path.join(projectDir, functionsBuildZip)));
    const zip = new admzip(functionsBuildZip);
    zip.extractAllTo(/*target path*/ path.join(projectDir), /*overwrite*/ true);
    // rename to desired dir, remove zip
    await Promise.all([
      fsPromise.rename(
        path.join(projectDir, originalUnzippedDirectory),
        path.join(projectDir, functionsBuild)
      ),
      fsPromise.rm(path.join(projectDir, functionsBuildZip)),
    ]);
    downloadSpinner.succeed('Downloaded functions template');

    Log.log('Bundling functions...');
    const functionDirectory = path.join(projectDir, 'functions');
    const functionEntries = await prepareFunctionEntriesAsync(functionDirectory);
    const outputDirectory = path.join(projectDir, functionsBuild, 'functions');
    await bundleFunctionsAsync(functionEntries, outputDirectory);
    Log.log('Successfully bundled functions...');

    Log.log('Doing web build...');
    const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
    const functionName = `${accountName}-${exp.slug}`; // TODO: set up a Cloudflare enterprise domain so we don't have to do this
    const region = 'us-east1';
    const cloudFunctionProject = 'eas-functions';
    const publicUrl = `https://${region}-${cloudFunctionProject}.cloudfunctions.net/${functionName}`;
    const webOutputDirectory = path.join(projectDir, functionsBuild, 'web-build');
    await expoCommandAsync(projectDir, ['build:web'], {
      env: { WEBPACK_BUILD_OUTPUT_PATH: webOutputDirectory, WEB_PUBLIC_URL: publicUrl },
    });
    Log.log('Finished web build...');

    const { path: compressedProjectPath } = await makeZipAsync(
      path.join(projectDir, functionsBuild)
    );
    const uploadSpinner = ora('Uploading project...').start();
    let bucketKey;
    try {
      const specification = await FunctionMutation.uploadAsync(projectId);
      const presignedPost: PresignedPost = JSON.parse(specification);
      await uploadWithPresignedPostAsync(compressedProjectPath, presignedPost);
      bucketKey = presignedPost.fields.key;
      uploadSpinner.succeed(`Successfully uploaded project to bucket: ${bucketKey}`);
    } catch (err) {
      uploadSpinner.fail('Failed to upload project');
      throw err;
    }

    const spinner = ora('Creating a function...').start();
    try {
      const success = await FunctionMutation.createAsync(bucketKey, projectId);
      spinner.succeed(`Successfully created function: ${success}`);
    } catch (err) {
      spinner.fail('Failed to create a function');
      throw err;
    }

    Log.log('Streaming build logs....');
    const logsPrinted = new Set<string>();
    let lastLog = null;
    while (true) {
      const { status, logUrls } = await FunctionMutation.getStatusAsync(projectId);
      Log.log(`Function status: ${status}`);

      const logsUrlsToPrint = logUrls.filter(url => !logsPrinted.has(url)).sort();
      const logResponses = await Promise.all(logsUrlsToPrint.map(url => fetch(url)));
      const logBodies = await Promise.all(logResponses.map(body => body.text()));
      const logPayloads = logBodies.map(body => JSON.parse(body)).map(body => body.textPayload);
      logPayloads.forEach(response => Log.log(response));
      logsUrlsToPrint.forEach(logUrl => logsPrinted.add(logUrl));
      lastLog = logPayloads.length > 0 ? logPayloads[logPayloads.length - 1] : lastLog;

      if (lastLog === 'DONE' && status === 'ACTIVE') {
        Log.log(`🎉🎉🎉 Hooray! Your function is complete!`);
        Log.log(`🎉🎉🎉 It is available at: ${publicUrl}`);
        break;
      } else if (status !== 'ACTIVE' && status !== 'DEPLOY_IN_PROGRESS') {
        Log.log(`🤔 Uh oh...your function is  ${status}`);
        break;
      }
      await sleepAsync(6000);
    }
  }
}
