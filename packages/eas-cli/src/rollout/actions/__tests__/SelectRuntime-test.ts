import { testUpdateBranch1, testUpdateBranch2 } from '../../../channel/__tests__/fixtures';
import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { RuntimeQuery } from '../../../graphql/queries/RuntimeQuery';
import { UpdateQuery } from '../../../graphql/queries/UpdateQuery';
import { confirmAsync, promptAsync } from '../../../prompts';
import { SelectRuntime } from '../SelectRuntime';

jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/RuntimeQuery');
jest.mock('../../../graphql/queries/UpdateQuery');
const runtimeFragment1 = { id: 'test-runtime-1-id', version: '1.0.0' };
const runtimeFragment2 = { id: 'test-runtime-2-id', version: '2.0.0' };
describe(SelectRuntime, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no runtimes', async () => {
    const ctx = createCtxMock();
    jest.mocked(RuntimeQuery.getRuntimesOnBranchAsync).mockResolvedValue({
      edges: [],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const selectRuntime = new SelectRuntime(testUpdateBranch1);
    const runtime = await selectRuntime.runAsync(ctx);
    expect(runtime).toBeNull();
  });
  it('still prompts if project has only one runtime', async () => {
    const ctx = createCtxMock();
    jest.mocked(RuntimeQuery.getRuntimesOnBranchAsync).mockResolvedValue({
      edges: [{ node: runtimeFragment1, cursor: 'cursor' }],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([]);
    jest.mocked(confirmAsync).mockImplementation(async () => true);
    const selectRuntime = new SelectRuntime(testUpdateBranch1);
    const runtime = await selectRuntime.runAsync(ctx);
    expect(runtime).toBe('1.0.0');
    expect(confirmAsync).toHaveBeenCalledTimes(1);
  });
  it('returns the selected runtime', async () => {
    jest.mocked(RuntimeQuery.getRuntimesOnBranchAsync).mockResolvedValue({
      edges: [
        { node: runtimeFragment1, cursor: 'cursor' },
        { node: runtimeFragment2, cursor: 'cursor' },
      ],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: runtimeFragment2,
    }));
    const ctx = createCtxMock();
    const selectRuntime = new SelectRuntime(testUpdateBranch1);
    const runtime = await selectRuntime.runAsync(ctx);
    expect(runtime).toBe('2.0.0');
  });
  it('filters the runtime by intersecting branch id', async () => {
    const ctx = createCtxMock();
    jest.mocked(RuntimeQuery.getRuntimesOnBranchAsync).mockResolvedValue({
      edges: [],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const selectRuntime = new SelectRuntime(testUpdateBranch1, {
      anotherBranchToIntersectRuntimesBy: testUpdateBranch2,
    });
    const runtime = await selectRuntime.runAsync(ctx);
    expect(runtime).toBeNull();
    expect(RuntimeQuery.getRuntimesOnBranchAsync).toBeCalledWith(
      expect.any(Function),
      expect.objectContaining({
        filter: { branchId: testUpdateBranch2.id },
      })
    );
  });
  it('throws an error in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const selectRuntime = new SelectRuntime(testUpdateBranch1);

    // dont fail if users are running in non-interactive mode
    await expect(selectRuntime.runAsync(ctx)).rejects.toThrowError(NonInteractiveError);
  });
});
