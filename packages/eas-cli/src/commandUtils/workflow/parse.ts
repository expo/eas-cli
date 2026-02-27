import * as YAML from 'yaml';

export function parsedYamlFromWorkflowContents(workflowFileContents: { yamlConfig: string }): any {
  return YAML.parse(workflowFileContents.yamlConfig, { merge: true });
}
