import { createGlobalContextMock } from './utils/context';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';

describe(BuildFunctionGroup, () => {
  it('handles __proto__ as an input name', () => {
    const ctx = createGlobalContextMock();
    const receivedValues: unknown[] = [];
    const group = new BuildFunctionGroup({
      namespace: 'test',
      id: 'group',
      inputProviders: [
        BuildStepInput.createProvider({
          id: '__proto__',
          defaultValue: 'default',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
      ],
      createBuildStepsFromFunctionGroupCall: (_ctx, { inputs }) => {
        receivedValues.push(
          inputs.__proto__.getValue({ interpolationContext: ctx.getInterpolationContext() })
        );
        return [];
      },
    });

    group.createBuildStepsFromFunctionGroupCall(ctx);
    group.createBuildStepsFromFunctionGroupCall(ctx, {
      callInputs: Object.fromEntries([['__proto__', 'provided']]),
    });

    expect(receivedValues).toEqual(['default', 'provided']);
  });
});
