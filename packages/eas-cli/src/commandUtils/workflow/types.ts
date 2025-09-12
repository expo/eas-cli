import { WorkflowJobByIdQuery, WorkflowRunByIdWithJobsQuery } from '../../graphql/generated';

/*
 * Utility types for workflow commands
 */

export enum WorkflowTriggerType {
  MANUAL = 'Manual',
  GITHUB = 'GitHub',
  SCHEDULED = 'Scheduled',
  OTHER = 'Other',
}

export type WorkflowRunResult = {
  id: string;
  status: string;
  gitCommitMessage: string | null;
  gitCommitHash: string | null;
  triggerType: WorkflowTriggerType;
  trigger: string | null;
  startedAt: string;
  finishedAt: string;
  workflowId: string;
  workflowName: string | null;
  workflowFileName: string;
};

export type WorkflowResult = {
  id: string;
  name?: string | null | undefined;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowJobResult =
  | WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number]
  | WorkflowJobByIdQuery['workflowJobs']['byId'];

export type WorkflowRunWithJobsResult = WorkflowRunResult & {
  jobs: WorkflowJobResult[];
  logs?: string;
};

export type WorkflowLogLine = { time: string; msg: string; result?: string; marker?: string };
export type WorkflowLogs = Map<string, WorkflowLogLine[]>;

export type WorkflowBuildJobOutput = {
  build_id: string;
  app_build_version: string | null;
  app_identifier: string | null;
  app_version: string | null;
  channel: string | null;
  distribution: 'internal' | 'store' | null;
  fingerprint_hash: string | null;
  git_commit_hash: string | null;
  platform: 'ios' | 'android' | null;
  profile: string | null;
  runtime_version: string | null;
  sdk_version: string | null;
  simulator: 'true' | 'false' | null;
};

export type WorkflowSubmitJobOutput = {
  apple_app_id: string | null; // Apple App ID. https://expo.fyi/asc-app-id
  ios_bundle_identifier: string | null; // iOS bundle identifier of the submitted build. https://expo.fyi/bundle-identifier
  android_package_id: string | null; // Submitted Android package ID. https://expo.fyi/android-package
};

export type WorkflowTestflightJobOutput = {
  apple_app_id: string | null; // Apple App ID. https://expo.fyi/asc-app-id
  ios_bundle_identifier: string | null; // iOS bundle identifier of the submitted build. https://expo.fyi/bundle-identifier
};

export type WorkflowUpdateJobOutput = {
  first_update_group_id: string; // ID of the first update group. You can use it to e.g. construct the update URL for a development client deep link.
  updates_json: string; // Stringified JSON array of update groups. Output of `eas update --json`.
};

export type WorkflowCustomJobOutput = {
  [key: string]: unknown;
};

export type WorkflowJobOutput =
  | WorkflowBuildJobOutput
  | WorkflowSubmitJobOutput
  | WorkflowTestflightJobOutput
  | WorkflowUpdateJobOutput
  | WorkflowCustomJobOutput;
