import * as YAML from 'yaml';

export function parsedYamlFromWorkflowContents(workflowFileContents: { yamlConfig: string }): any {
  return YAML.parse(workflowFileContents.yamlConfig, {
    // Keep in sync with backend parser options.
    merge: true,
    maxAliasCount: 50,
  });
}
