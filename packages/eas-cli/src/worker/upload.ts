import { ora } from '../ora';
import Log from '../log';

export interface UploadResultName {
  fullName: string;
  name: string;
  id?: string;
}

export const uploadWorkerAsync = async (
  url: string,
  contents: BodyInit
): Promise<UploadResultName> => {
  Log.addNewLineIfNone();

  const uploadSpinner = ora('Uploading & Deploying').start();

  const response = await fetch(url, {
    method: 'POST',
    body: contents,
  });

  if (response.ok) {
    const json = await response.json();
    if (!json.success) {
      throw new Error(json.message ? `${json.message}` : 'Upload failed!');
    }

    uploadSpinner.succeed('Deployed worker');
    return json.result;
  } else {
    uploadSpinner.fail('Failed to deploy worker');

    if (response.status === 413) {
      throw new Error(
        'Upload failed! (Payload too large)\n' +
          'The combined file-size of your upload was too large.'
      );
    }

    throw new Error(`Upload failed! (${response.statusText})`);
  }
};
