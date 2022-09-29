import chalk from 'chalk';

class NamedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = chalk.red(this.constructor.name);
  }
}

export class InvalidEasJsonError extends NamedError {}

export class MissingEasJsonError extends NamedError {}

export class MissingProfileError extends NamedError {}

export class MissingParentProfileError extends NamedError {}
