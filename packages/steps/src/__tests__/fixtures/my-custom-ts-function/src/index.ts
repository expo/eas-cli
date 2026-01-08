import {
  BuildStepContext,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
  BuildStepEnv,
} from '@expo/steps';

interface MyTsFunctionInputs {
  name: BuildStepInput<BuildStepInputValueTypeName.STRING, true>;
  num: BuildStepInput<BuildStepInputValueTypeName.NUMBER, true>;
  obj: BuildStepInput<BuildStepInputValueTypeName.JSON, true>;
}

interface MyTsFunctionOutputs {
  name: BuildStepOutput<true>;
  num: BuildStepOutput<true>;
  obj: BuildStepOutput<true>;
}

async function myTsFunctionAsync(
  ctx: BuildStepContext,
  {
    inputs,
    outputs,
    env,
  }: {
    inputs: MyTsFunctionInputs;
    outputs: MyTsFunctionOutputs;
    env: BuildStepEnv;
  }
): Promise<void> {
  ctx.logger.info('Running my custom TS function');
  ctx.logger.info(`Hello, ${inputs.name.value}!}`);
  ctx.logger.info(`Your number is ${inputs.num.value}`);
  ctx.logger.info(`Your object is ${JSON.stringify(inputs.obj.value)}`);
  ctx.logger.info('Done running my custom TS function');
  ctx.logger.warn('Warning from my custom TS function');
  ctx.logger.error('Error from my custom TS function');
  ctx.logger.info('Running a command');
  ctx.logger.debug('Debugging a command');
  ctx.logger.fatal('Fatal error from my custom TS function');

  ctx.logger.info('Setting outputs');
  outputs.name.set('Brent');
  outputs.num.set('123');
  outputs.obj.set(JSON.stringify({ foo: 'bar' })); // TODO: add support for other types of outputs then string

  ctx.logger.info('Setting env vars');
  env['MY_ENV_VAR'] = 'my-value';
}

export default myTsFunctionAsync;
