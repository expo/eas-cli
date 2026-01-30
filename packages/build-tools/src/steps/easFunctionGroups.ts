import { BuildFunctionGroup } from '@expo/steps';

import { createEasBuildBuildFunctionGroup } from './functionGroups/build';
import { createEasMaestroTestFunctionGroup } from './functionGroups/maestroTest';
import { CustomBuildContext } from '../customBuildContext';

export function getEasFunctionGroups(ctx: CustomBuildContext): BuildFunctionGroup[] {
  const functionGroups = [createEasMaestroTestFunctionGroup(ctx)];

  if (ctx.hasBuildJob()) {
    functionGroups.push(...[createEasBuildBuildFunctionGroup(ctx)]);
  }

  return functionGroups;
}
