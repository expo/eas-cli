import admzip from 'adm-zip';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import tar from 'tar';
import { v4 as uuidv4 } from 'uuid';

import Log from '../../log';
import { ora } from '../../ora';
import { confirmAsync, promptAsync } from '../../prompts';
import { formatBytes } from '../../utils/files';
import { getTmpDirectory } from '../../utils/paths';
import { endTimer, formatMilliseconds, startTimer } from '../../utils/timer';
import { getVcsClient } from '../../vcs';

export async function maybeBailOnRepoStatusAsync(): Promise<void> {
  if (!(await getVcsClient().isCommitRequiredAsync())) {
    return;
  }
  Log.addNewLineIfNone();
  Log.warn(`${chalk.bold('Warning!')} Your repository working tree is dirty.`);
  Log.log(
    `It's recommended to ${chalk.bold(
      'commit all your changes before proceeding'
    )}, so you can revert the changes made by this command if necessary.`
  );
  const answer = await confirmAsync({
    message: `Would you like to proceed?`,
  });

  if (!answer) {
    throw new Error('Please commit all changes. Aborting...');
  }
}

export async function ensureRepoIsCleanAsync(nonInteractive = false): Promise<void> {
  if (!(await getVcsClient().isCommitRequiredAsync())) {
    return;
  }
  Log.addNewLineIfNone();
  Log.warn(`${chalk.bold('Warning!')} Your repository working tree is dirty.`);
  Log.log(
    `This operation needs to be run on a clean working tree, please ${chalk.bold(
      'commit all your changes before proceeding'
    )}.`
  );
  if (nonInteractive) {
    throw new Error('Please commit all changes. Aborting...');
  }
  const answer = await confirmAsync({
    message: `Commit changes to git?`,
  });
  if (answer) {
    await commitPromptAsync({ commitAllFiles: true });
  } else {
    throw new Error('Please commit all changes. Aborting...');
  }
}

export async function commitPromptAsync({
  initialCommitMessage,
  commitAllFiles,
}: {
  initialCommitMessage?: string;
  commitAllFiles?: boolean;
} = {}): Promise<void> {
  const { message } = await promptAsync({
    type: 'text',
    name: 'message',
    message: 'Commit message:',
    initial: initialCommitMessage,
    validate: (input: string) => input !== '',
  });
  await getVcsClient().commitAsync({ commitAllFiles, commitMessage: message });
}

export async function makeProjectTarballAsync(): Promise<{ path: string; size: number }> {
  const spinner = ora('Compressing project files');

  await fs.mkdirp(getTmpDirectory());
  const shallowClonePath = path.join(getTmpDirectory(), `${uuidv4()}-shallow-clone`);
  const tarPath = path.join(getTmpDirectory(), `${uuidv4()}.tar.gz`);

  // If the compression takes longer then a second, show the spinner.
  // This can happen when the user has a lot of resources or doesn't ignore their CocoaPods.
  // A basic project on a Mac can compress in roughly ~40ms.
  // A fairly complex project without CocoaPods ignored can take up to 30s.
  const timer = setTimeout(
    () => {
      spinner.start();
    },
    Log.isDebug ? 1 : 1000
  );
  // TODO: Possibly warn after more time about unoptimized assets.
  const compressTimerLabel = 'makeProjectTarballAsync';
  startTimer(compressTimerLabel);

  try {
    await getVcsClient().makeShallowCopyAsync(shallowClonePath);
    await tar.create({ cwd: shallowClonePath, file: tarPath, prefix: 'project', gzip: true }, [
      '.',
    ]);
  } catch (err) {
    clearTimeout(timer);
    if (spinner.isSpinning) {
      spinner.fail();
    }
    throw err;
  } finally {
    await fs.remove(shallowClonePath);
  }
  clearTimeout(timer);

  const { size } = await fs.stat(tarPath);
  const duration = endTimer(compressTimerLabel);
  if (spinner.isSpinning) {
    const prettyTime = formatMilliseconds(duration);
    spinner.succeed(
      `Compressed project files ${chalk.dim(`${prettyTime} (${formatBytes(size)})`)}`
    );
  }

  return { size, path: tarPath };
}

export async function makeZipAsync(pathToZip: string): Promise<{ path: string; size: number }> {
  const spinner = ora('Compressing project files');

  await fs.mkdirp(getTmpDirectory());
  const shallowClonePath = path.join(getTmpDirectory(), `${uuidv4()}-shallow-clone`);

  try {
    process.chdir(pathToZip);
    await getVcsClient().makeShallowCopyAsync(shallowClonePath);
    process.chdir('..');

    const zipPath = path.join(getTmpDirectory(), `${uuidv4()}.zip`);

    // If the compression takes longer then a second, show the spinner.
    // This can happen when the user has a lot of resources or doesn't ignore their CocoaPods.
    // A basic project on a Mac can compress in roughly ~40ms.
    // A fairly complex project without CocoaPods ignored can take up to 30s.
    const timer = setTimeout(
      () => {
        spinner.start();
      },
      Log.isDebug ? 1 : 1000
    );
    // TODO: Possibly warn after more time about unoptimized assets.
    const compressTimerLabel = 'makeProjectZipAsync';
    startTimer(compressTimerLabel);

    const zip = new admzip();
    zip.addLocalFolder(shallowClonePath);
    await zipAsync(zip, zipPath);
    clearTimeout(timer);

    const { size } = await fs.stat(zipPath);
    const duration = endTimer(compressTimerLabel);
    if (spinner.isSpinning) {
      const prettyTime = formatMilliseconds(duration);
      spinner.succeed(
        `Compressed project files ${chalk.dim(`${prettyTime} (${formatBytes(size)})`)}`
      );
    }

    return { size, path: zipPath };
  } catch (err) {
    if (spinner.isSpinning) {
      spinner.fail();
    }
    throw err;
  } finally {
    await fs.remove(shallowClonePath);
  }
}

async function zipAsync(zip: admzip, targetFileName?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.writeZip(targetFileName, (error: Error | null) => (error ? reject(error) : resolve()));
  });
}
enum ShouldCommitChanges {
  Yes,
  ShowDiffFirst,
  Abort,
}

export async function reviewAndCommitChangesAsync(
  initialCommitMessage: string,
  { nonInteractive, askedFirstTime = true }: { nonInteractive: boolean; askedFirstTime?: boolean }
): Promise<void> {
  if (process.env.EAS_BUILD_AUTOCOMMIT) {
    await getVcsClient().commitAsync({
      commitMessage: initialCommitMessage,
      commitAllFiles: false,
      nonInteractive,
    });
    Log.withTick('Committed changes.');
    return;
  }
  if (nonInteractive) {
    throw new Error(
      'Cannot commit changes when --non-interactive is specified. Run the command in interactive mode or set EAS_BUILD_AUTOCOMMIT=1 in your environment.'
    );
  }
  const { selected } = await promptAsync({
    type: 'select',
    name: 'selected',
    message: 'Can we commit these changes to git for you?',
    choices: [
      { title: 'Yes', value: ShouldCommitChanges.Yes },
      ...(askedFirstTime
        ? [{ title: 'Show the diff and ask me again', value: ShouldCommitChanges.ShowDiffFirst }]
        : []),
      {
        title: 'Abort build process',
        value: ShouldCommitChanges.Abort,
      },
    ],
  });

  if (selected === ShouldCommitChanges.Abort) {
    throw new Error(
      "Aborting, run the command again once you're ready. Make sure to commit any changes you've made."
    );
  } else if (selected === ShouldCommitChanges.Yes) {
    await commitPromptAsync({ initialCommitMessage });
    Log.withTick('Committed changes.');
  } else if (selected === ShouldCommitChanges.ShowDiffFirst) {
    await getVcsClient().showDiffAsync();
    await reviewAndCommitChangesAsync(initialCommitMessage, {
      nonInteractive,
      askedFirstTime: false,
    });
  }
}
