import { CombinedError } from '@urql/core';
import fs from 'fs';
import path from 'path';

import { getProjectGitHubSettingsUrl } from '../build/utils/url';
import { WorkflowRevisionMutation } from '../graphql/mutations/WorkflowRevisionMutation';
import Log, { link } from '../log';

export namespace WorkflowFile {
  export async function readWorkflowFileContentsAsync({
    projectDir,
    filePath,
  }: {
    projectDir: string;
    filePath: string;
  }): Promise<{ yamlConfig: string; filePath: string }> {
    const [yamlFromEasWorkflowsFile, yamlFromFile] = await Promise.allSettled([
      fs.promises.readFile(path.join(projectDir, '.eas', 'workflows', filePath), 'utf8'),
      fs.promises.readFile(filePath, 'utf8'),
    ]);

    // We prioritize .eas/workflows/${file} over ${file}, because
    // in the worst case we'll try to read .eas/workflows/.eas/workflows/test.yml,
    // which is likely not to exist.
    if (yamlFromEasWorkflowsFile.status === 'fulfilled') {
      return {
        yamlConfig: yamlFromEasWorkflowsFile.value,
        filePath: path.join(projectDir, '.eas', 'workflows', filePath),
      };
    } else if (yamlFromFile.status === 'fulfilled') {
      return {
        yamlConfig: yamlFromFile.value,
        filePath: path.join(projectDir, filePath),
      };
    }

    throw yamlFromFile.reason;
  }

  export function maybePrintWorkflowFileValidationErrors({
    error,
    accountName,
    projectName,
  }: {
    error: CombinedError;
    accountName: string;
    projectName: string;
  }): void {
    const validationErrors = error.graphQLErrors.flatMap(e => {
      return WorkflowRevisionMutation.ValidationErrorExtensionZ.safeParse(e.extensions).data ?? [];
    });

    if (validationErrors.length > 0) {
      Log.error('Workflow file is invalid. Issues:');
      for (const validationError of validationErrors) {
        for (const formError of validationError.metadata.formErrors) {
          Log.error(`- ${formError}`);
        }

        for (const [field, fieldErrors] of Object.entries(validationError.metadata.fieldErrors)) {
          Log.error(`- ${field}: ${fieldErrors.join(', ')}`);
        }
      }
    }

    const githubNotFoundError = error.graphQLErrors.find(
      e => e.extensions.errorCode === 'GITHUB_NOT_FOUND_ERROR'
    );
    if (githubNotFoundError) {
      Log.error(`GitHub repository not found. It is currently required to run workflows.`);
      Log.error(
        `Please check that the repository exists and that you have access to it. ${link(
          getProjectGitHubSettingsUrl(accountName, projectName)
        )}`
      );
    }
  }
}
