import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { UpdateBranchBasicInfoFragment } from '../../../graphql/generated';
import { BranchQuery } from '../../../graphql/queries/BranchQuery';
import { promptAsync } from '../../../prompts';
import { testBasicBranchInfo, testBasicBranchInfo2 } from '../../__tests__/fixtures';
import { SelectBranch } from '../SelectBranch';

jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/BranchQuery');
describe(SelectBranch, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no branchs', async () => {
    const ctx = createCtxMock();
    jest.mocked(BranchQuery.listBranchesBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const selectBranch = new SelectBranch();
    const branch = await selectBranch.runAsync(ctx);
    expect(branch).toBeNull();
  });
  it('still prompts if project has only one branch', async () => {
    const ctx = createCtxMock();
    jest.mocked(BranchQuery.listBranchesBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [{ node: testBasicBranchInfo, cursor: 'cursor' }],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: testBasicBranchInfo,
    }));
    const selectBranch = new SelectBranch();
    const branch = await selectBranch.runAsync(ctx);
    expect(branch).toBe(testBasicBranchInfo);
    expect(promptAsync).toHaveBeenCalledTimes(1);
  });
  it('returns the selected branch', async () => {
    jest.mocked(BranchQuery.listBranchesBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [
        { node: testBasicBranchInfo, cursor: 'cursor' },
        { node: testBasicBranchInfo2, cursor: 'cursor' },
      ],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: testBasicBranchInfo,
    }));
    const ctx = createCtxMock();
    const selectBranch = new SelectBranch();
    const branch = await selectBranch.runAsync(ctx);
    expect(branch).toBe(testBasicBranchInfo);
  });
  it('returns the only available branch with a filter', async () => {
    jest.mocked(BranchQuery.listBranchesBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [
        { node: testBasicBranchInfo, cursor: 'cursor' },
        { node: testBasicBranchInfo2, cursor: 'cursor' },
      ],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const ctx = createCtxMock();
    const selectBranch = new SelectBranch({
      filterPredicate: (branchInfo: UpdateBranchBasicInfoFragment) =>
        branchInfo === testBasicBranchInfo,
    });
    const branch = await selectBranch.runAsync(ctx);
    expect(branch).toBe(testBasicBranchInfo);
  });
  it('throws an error in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const selectBranch = new SelectBranch();

    // dont fail if users are running in non-interactive mode
    await expect(selectBranch.runAsync(ctx)).rejects.toThrowError(NonInteractiveError);
  });
});
