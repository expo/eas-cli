import { isStepFunctionStep, isStepShellStep, StepZ, validateSteps } from '../step';

describe('StepZ', () => {
  it('accepts valid script step', () => {
    const step = {
      run: 'echo Hello, world!',
      shell: 'sh',
      outputs: [
        {
          name: 'my_output',
          required: true,
        },
        {
          name: 'my_optional_output',
          required: false,
        },
        {
          name: 'my_optional_output_without_required',
        },
      ],
    };
    expect(StepZ.parse(step)).toEqual(step);
  });

  it('accepts valid function step', () => {
    const step = {
      uses: 'eas/build',
      with: {
        arg1: 'value1',
        arg2: 2,
        arg3: {
          key1: 'value1',
          key2: ['value1'],
        },
        arg4: '${{ steps.step1.outputs.test }}',
        arg5: true,
        arg6: [1, 2, 3],
      },
    };
    expect(StepZ.parse(step)).toEqual(step);
  });

  it('errors when step is both script and function step', () => {
    const step = {
      run: 'echo Hello, world!',
      uses: 'eas/build',
    };
    expect(() => StepZ.parse(step)).toThrow('Invalid input');
  });

  it('errors when step is neither script nor function step', () => {
    const step = {
      id: 'step1',
      name: 'Step 1',
    };
    expect(() => StepZ.parse(step)).toThrow('Invalid input');
  });

  it('valid step with all properties', () => {
    const step = {
      id: 'step1',
      name: 'Step 1',
      if: '${ steps.step1.outputs.test } == 1',
      run: 'echo Hello, world!',
      shell: 'sh',
      env: {
        KEY1: 'value1',
      },
    };
    expect(StepZ.parse(step)).toEqual(step);
  });
});

describe(isStepShellStep, () => {
  it('returns true for shell step', () => {
    expect(isStepShellStep({ run: 'echo Hello, world!', shell: 'sh' })).toBe(true);
  });

  it('returns false for function step', () => {
    expect(isStepShellStep({ uses: 'eas/build' })).toBe(false);
  });
});

describe(isStepFunctionStep, () => {
  it('returns true for function step', () => {
    expect(isStepFunctionStep({ uses: 'eas/build' })).toBe(true);
  });

  it('returns false for shell step', () => {
    expect(isStepFunctionStep({ run: 'echo Hello, world!', shell: 'sh' })).toBe(false);
  });
});

describe(validateSteps, () => {
  it('accepts valid steps', () => {
    const steps = [
      {
        run: 'echo Hello, world!',
        shell: 'sh',
      },
      {
        uses: 'eas/build',
      },
    ];
    expect(validateSteps(steps)).toEqual(steps);
  });

  it('errors when steps is empty', () => {
    expect(() => validateSteps([])).toThrow('Too small: expected array to have >=1 items');
  });
});
