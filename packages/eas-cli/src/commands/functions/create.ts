import { getConfig } from '@expo/config';
import fs from 'fs-extra';

import { makeProjectZipAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { FunctionMutation } from '../../graphql/mutations/FunctionMutation';
import { PresignedPost } from '../../graphql/mutations/UploadSessionMutation';
import { ora } from '../../ora';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { uploadWithPresignedPostAsync } from '../../uploads';

export default class FunctionsCreate extends EasCommand {
  static description = 'create a function';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    const spinner = ora('Creating a function').start();
    try {
      const { path: compressedProjectPath } = await makeProjectZipAsync();
      const specification = await FunctionMutation.uploadAsync(projectId);
      const presignedPost: PresignedPost = JSON.parse(specification);
      await uploadWithPresignedPostAsync(fs.createReadStream(compressedProjectPath), presignedPost);
      const bucketKey = presignedPost.fields.key;
      spinner.succeed(`Successfully uploaded function to S3: ${presignedPost.fields.key}`);
      const success = await FunctionMutation.createAsync(bucketKey);
      spinner.succeed(`Successfully created function: ${success}`);
    } catch (err) {
      spinner.fail('Failed to create a function');
      throw err;
    }
  }
}
