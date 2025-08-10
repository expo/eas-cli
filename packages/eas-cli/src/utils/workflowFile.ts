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
    // If the input is an absolute path, the user was clear about the file they wanted to run.
    // We only check that file path.
    if (path.isAbsolute(filePath)) {
      return { yamlConfig: await fs.promises.readFile(filePath, 'utf8'), filePath };
    }

    // If the input is a relative path (which "deploy-to-production", "deploy-to-production.yml"
    // and ".eas/workflows/deploy-to-production.yml" are), we try to find the file.
    const pathsToSearch = [
      path.join(projectDir, '.eas', 'workflows', `${filePath}.yaml`),
      path.join(projectDir, '.eas', 'workflows', `${filePath}.yml`),
      path.join(projectDir, '.eas', 'workflows', filePath),
      path.resolve(filePath),
    ];

    let lastError: any = null;

    for (const path of pathsToSearch) {
      try {
        const yamlConfig = await fs.promises.readFile(path, 'utf8');
        return { yamlConfig, filePath: path };
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    throw lastError;
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

  export function validateYamlExtension(fileName: string): void {
    const fileExtension = path.extname(fileName).toLowerCase();
    if (fileExtension !== '.yml' && fileExtension !== '.yaml') {
      throw new Error('File must have a .yml or .yaml extension');
    }
  }
}
