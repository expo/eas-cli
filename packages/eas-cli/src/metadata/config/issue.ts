import { MetadataConfig } from './schema';

export enum IssueSeverity {
  info = 0,
  warn = 1,
  error = 2,
}

export interface Issue {
  /** The type of issue, auto-generated for AJV errors based on the validation type */
  id: string;
  /** The severity of the lint message */
  severity: IssueSeverity;
  /** The data path, using segments, to the source of this message */
  path: string[];
  /** A human readable description of the issue, presented to users */
  message: string;
}

export interface IssueRule<Data = MetadataConfig> {
  id: string;
  severity: IssueSeverity;
  validate(config: Data): null | Issue | Issue[];
}
