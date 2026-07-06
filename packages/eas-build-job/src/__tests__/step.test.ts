import { StepZ, isStepFunctionStep, isStepShellStep, validateSteps } from '../step';

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

describe('hook anchor stamps', () => {
  it('accepts the internal __hook_id stamp field on shell steps', () => {
    const steps = [{ run: 'echo submit', __hook_id: 'submit' }];
    expect(validateSteps(steps)).toEqual(steps);
  });

  it('accepts and retains the __hook_id stamp on uses: steps', () => {
    const steps = [{ uses: 'eas/upload_to_asc', __hook_id: 'submit' }];
    expect(validateSteps(steps)).toEqual(steps);
  });

  it('strips the removed split-pair stamp fields (legacy __hook_before_id/__hook_after_id)', () => {
    expect(
      validateSteps([
        { run: 'echo x', __hook_before_id: 'maestro_cloud', __hook_after_id: 'maestro_cloud' },
      ])
    ).toEqual([{ run: 'echo x' }]);
  });

  it('treats stamp values as loose strings so old workers never hard-fail on new anchors', () => {
    expect(() => validateSteps([{ run: 'echo x', __hook_id: 'some_future_anchor' }])).not.toThrow();
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
