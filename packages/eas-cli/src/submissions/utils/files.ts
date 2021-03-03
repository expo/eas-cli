import glob from 'fast-glob';
import fs from 'fs-extra';
import got from 'got';
import os from 'os';
import { basename, extname, join } from 'path';
import stream from 'stream';
import tar from 'tar';
import { promisify } from 'util';

import { UploadType, uploadAsync } from '../../uploads';
import { createProgressTracker } from '../../utils/progress';

const pipeline = promisify(stream.pipeline);

export async function isExistingFile(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (e) {
    return false;
  }
}

async function moveFileOfTypeAsync(
  directory: string,
  extension: string,
  dest: string
): Promise<string> {
  const [matching] = await glob(`**/*.${extension}`, {
    absolute: true,
    cwd: directory,
  });

  if (!matching) {
    throw new Error(`No .${extension} files found in directory: ${directory}`);
  }

  // The incoming destination may be tar.gz because it wasn't clear what type of app file was included.
  // Compare the app file extension with the destination extension and if they don't match,
  // append the app file extension to the destination. Ex. App.tar.gz.ipa
  const matchingExtension = extname(matching).toLowerCase();
  const destExtension = extname(dest).toLowerCase();

  if (matchingExtension !== destExtension) {
    dest = `${dest}${matchingExtension}`;
  }

  // Ensure we actually need to move the file.
  if (matching !== dest) {
    await fs.move(matching, dest);
  }

  return dest;
}

export function createDownloadStream(url: string) {
  return got
    .stream(url)
    .on(
      'downloadProgress',
      createProgressTracker({ message: 'Downloading app', completedMessage: 'Downloaded app' })
    );
}

export function pathIsTar(path: string): boolean {
  return path.endsWith('tar.gz');
}

export async function downloadAppArchiveAsync(url: string): Promise<string> {
  const filename = basename(url);
  // Since we may need to rename the destination path,
  // add everything to a folder which can be nuked to ensure we don't accidentally use an old build with the same name.
  const destinationFolder = await createTemporaryDirectoryForExtractionAsync();
  const destinationPath = join(destinationFolder, filename);

  const downloadStream = createDownloadStream(url);
  // Special use-case for downloading an EAS tar.gz file and unpackaging it.
  if (pathIsTar(url)) {
    await pipeline(downloadStream, tar.extract({ cwd: destinationFolder }, []));
    // Move the folder contents matching .ipa, .apk, or .aab
    return await moveFileOfTypeAsync(destinationFolder, '{ipa,apk,aab}', destinationPath);
  } else {
    await pipeline(downloadStream, fs.createWriteStream(destinationPath));
  }
  return destinationPath;
}

export async function uploadAppArchiveAsync(path: string): Promise<string> {
  const fileSize = (await fs.stat(path)).size;
  const { url } = await uploadAsync(
    UploadType.SUBMISSION_APP_ARCHIVE,
    path,
    createProgressTracker({
      total: fileSize,
      message: 'Uploading to EAS Submit',
      completedMessage: 'Uploaded to EAS Submit',
    })
  );
  return url;
}

async function createTemporaryDirectoryForExtractionAsync(): Promise<string> {
  // Since we may need to rename the destination path,
  // add everything to a folder which can be nuked to ensure we don't accidentally use an old build with the same name.
  const destinationFolder = join(os.tmpdir(), 'expo-submission-service');

  if (await fs.pathExists(destinationFolder)) {
    await fs.remove(destinationFolder);
  }
  await fs.ensureDir(destinationFolder);

  return destinationFolder;
}

async function decompressTarAsync(src: string, destination: string): Promise<void> {
  await pipeline(fs.createReadStream(src), tar.extract({ cwd: destination }, []));
}

export async function extractLocalArchiveAsync(filePath: string): Promise<string> {
  if (!pathIsTar(filePath)) {
    // No need to extract, copy, or rename the file.
    // Leave it in place and return the path.
    return filePath;
  }

  const filename = basename(filePath);
  // Since we may need to rename the destination path,
  // add everything to a folder which can be nuked to ensure we don't accidentally use an old build with the same name.
  const destinationFolder = await createTemporaryDirectoryForExtractionAsync();
  const destinationPath = join(destinationFolder, filename);

  // Special use-case for downloading an EAS tar.gz file and unpackaging it.
  await decompressTarAsync(filePath, destinationFolder);
  // Move the folder contents matching .ipa, .apk, or .aab
  return await moveFileOfTypeAsync(destinationFolder, '{ipa,apk,aab}', destinationPath);
}
