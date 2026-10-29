import { type CustomBuildContext } from '../../customBuildContext';
import { getEasFunctions } from '../easFunctions';

it('registers opt-in session functions with the existing inputs', () => {
  const functions = getEasFunctions({ hasBuildJob: () => false } as CustomBuildContext);
  for (const name of ['serve_sim_remote', 'agent_device', 'argent_remote']) {
    const existing = functions.find(fn => fn.id === `start_${name}_session`)!;
    const warm = functions.find(fn => fn.id === `start_warm_${name}_session`)!;
    expect(warm.getFullId()).toBe(`eas/start_warm_${name}_session`);
    const warmInputs = warm.inputProviders!.map(input => input(undefined as never, 'warm').id);
    const existingInputs = existing.inputProviders!.map(
      input => input(undefined as never, 'existing').id
    );
    expect(warmInputs).toEqual(existingInputs);
  }
  const ids = functions.map(fn => fn.getFullId());
  expect(new Set(ids).size).toBe(ids.length);
});
