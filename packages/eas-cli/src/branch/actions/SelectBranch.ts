import { EASUpdateAction, EASUpdateContext, NonInteractiveError } from '../../eas-update/utils';
import { UpdateBranchBasicInfoFragment } from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { getBranchesDatasetAsync } from '../queries';

/**
 * Select a branch for the project.
 *
 * @constructor
 * @param {function} options.filterPredicate - A predicate to filter the branches that are shown to the user. It takes a branchInfo object as a parameter and returns a boolean.
 * @param {string} options.printedType - The type of branch printed to the user. Defaults to 'branch'.
 */
export class SelectBranch implements EASUpdateAction<UpdateBranchBasicInfoFragment | null> {
  constructor(
    private options: {
      filterPredicate?: (branchInfo: UpdateBranchBasicInfoFragment) => boolean;
      printedType?: string;
    } = {}
  ) {}
  public async runAsync(ctx: EASUpdateContext): Promise<UpdateBranchBasicInfoFragment | null> {
    const { nonInteractive, graphqlClient, app } = ctx;
    const { projectId } = app;
    const { filterPredicate } = this.options;
    const printedType = this.options.printedType ?? 'branch';
    if (nonInteractive) {
      throw new NonInteractiveError(
        `${printedType} selection cannot be run in non-interactive mode.`
      );
    }

    const branches = await getBranchesDatasetAsync(graphqlClient, {
      appId: projectId,
      filterPredicate,
    });

    if (branches.length === 0) {
      return null;
    } else if (branches.length === 1) {
      return branches[0];
    }

    const { branch: selectedBranch } = await promptAsync({
      type: 'select',
      name: 'branch',
      message: `Select a ${printedType}`,
      choices: branches.map(branch => ({
        value: branch,
        title: branch.name,
      })),
    });
    return selectedBranch;
  }
}
