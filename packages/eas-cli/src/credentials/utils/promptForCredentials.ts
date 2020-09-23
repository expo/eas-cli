import fs from 'fs-extra';
import once from 'lodash/once';
import path from 'path';
import untildify from 'untildify';

import log from '../../log';
import { Question as PromptQuestion, prompt } from '../../prompts';

export type Question = {
  question: string;
  type: 'file' | 'string' | 'password';
  base64Encode?: boolean;
};

export type CredentialSchema<T> = {
  id: string;
  canReuse?: boolean;
  dependsOn?: string;
  name: string;
  required: (keyof T)[];
  questions: Record<keyof T, Question>;
  deprecated?: boolean;
  migrationDocs?: string;
  provideMethodQuestion?: {
    question?: string;
    expoGenerated?: string;
    userProvided?: string;
  };
};

const EXPERT_PROMPT = once(() =>
  log.warn(`
WARNING! In this mode, we won't be able to make sure that your credentials are valid.
Please double check that you're uploading valid files for your app otherwise you may encounter strange errors!

When building for IOS make sure you've created your App ID on the Apple Developer Portal, that your App ID
is in app.json as \`bundleIdentifier\`, and that the provisioning profile you
upload matches that Team ID and App ID.
`)
);

export async function askForUserProvidedAsync<T>(schema: CredentialSchema<T>): Promise<T | null> {
  if (await willUserProvideCredentialsAsync<T>(schema)) {
    EXPERT_PROMPT();
    return await getCredentialsFromUserAsync<T>(schema);
  }
  return null;
}

export async function getCredentialsFromUserAsync<T>(
  credentialsSchema: CredentialSchema<T>
): Promise<T | null> {
  const results: { [key in keyof T]?: string } = {};
  for (const field of credentialsSchema.required) {
    results[field] = await askQuestionAndProcessAnswerAsync(credentialsSchema.questions[field]);
  }
  return results as T;
}

async function willUserProvideCredentialsAsync<T>(schema: CredentialSchema<T>) {
  const { answer } = await prompt({
    type: 'select',
    name: 'answer',
    message: schema?.provideMethodQuestion?.question ?? `Will you provide your own ${schema.name}?`,
    choices: [
      {
        title: schema?.provideMethodQuestion?.expoGenerated ?? 'Let Expo handle the process',
        value: false,
      },
      {
        title: schema?.provideMethodQuestion?.userProvided ?? 'I want to upload my own file',
        value: true,
      },
    ],
  });
  return answer;
}

async function askQuestionAndProcessAnswerAsync(definition: Question): Promise<string> {
  const questionObject = buildQuestionObject(definition);
  const { input } = await prompt(questionObject);
  return await processAnswerAsync(definition, input);
}

function buildQuestionObject({ type, question }: Question): PromptQuestion {
  switch (type) {
    case 'string':
      return {
        type: 'text',
        name: 'input',
        message: question,
        validate: validateNonEmptyInput,
      };
    case 'file':
      return {
        type: 'text',
        name: 'input',
        message: question,
        format: produceAbsolutePath,
        validate: validateExistingFileAsync,
      };
    case 'password':
      return {
        type: 'password',
        name: 'input',
        message: question,
        validate: validateNonEmptyInput,
      };
  }
}

async function processAnswerAsync(
  { type, base64Encode }: Question,
  input: string
): Promise<string> {
  if (type === 'file') {
    return await fs.readFile(input, base64Encode ? 'base64' : 'utf8');
  } else {
    return input;
  }
}

function produceAbsolutePath(filePath: string): string {
  const untildified = untildify(filePath.trim());
  return !path.isAbsolute(untildified) ? path.resolve(untildified) : untildified;
}

function validateNonEmptyInput(val: string) {
  return val !== '';
}

async function validateExistingFileAsync(filePath: string): Promise<boolean | string> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isFile()) {
      return true;
    }
    return 'Input is not a file.';
  } catch {
    return 'File does not exist.';
  }
}
