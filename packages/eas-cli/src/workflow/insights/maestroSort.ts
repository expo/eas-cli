import {
  WorkflowDeviceTestCaseSortDirection,
  WorkflowDeviceTestCaseStatSortField,
} from '../../graphql/generated';

export const MAESTRO_SORT_OPTIONS = [
  'fails',
  'runs',
  'flakes',
  'pass-rate',
  'flake-rate',
  'p90',
  'last-run',
] as const;
export type MaestroSortOption = (typeof MAESTRO_SORT_OPTIONS)[number];

export const MAESTRO_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type MaestroSortDirection = (typeof MAESTRO_SORT_DIRECTIONS)[number];

export const SORT_FIELD_BY_OPTION: Record<MaestroSortOption, WorkflowDeviceTestCaseStatSortField> =
  {
    runs: WorkflowDeviceTestCaseStatSortField.Runs,
    fails: WorkflowDeviceTestCaseStatSortField.Fails,
    flakes: WorkflowDeviceTestCaseStatSortField.Flakes,
    'pass-rate': WorkflowDeviceTestCaseStatSortField.PassRate,
    'flake-rate': WorkflowDeviceTestCaseStatSortField.FlakeRate,
    p90: WorkflowDeviceTestCaseStatSortField.P90Duration,
    'last-run': WorkflowDeviceTestCaseStatSortField.LastRun,
  };

export const SORT_DIRECTION_BY_OPTION: Record<
  MaestroSortDirection,
  WorkflowDeviceTestCaseSortDirection
> = {
  asc: WorkflowDeviceTestCaseSortDirection.Asc,
  desc: WorkflowDeviceTestCaseSortDirection.Desc,
};
