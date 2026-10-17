import { ExperimentationClient } from './ExperimentationClient';

/**
 * Defers building the experimentation client, and the config fetch behind it, until a command
 * first needs a variant.
 */
export class LazyExperimentationClient {
  private pending: Promise<ExperimentationClient> | null = null;

  constructor(private readonly loadAsync: () => Promise<ExperimentationClient>) {}

  public static fromClient(client: ExperimentationClient): LazyExperimentationClient {
    return new LazyExperimentationClient(async () => client);
  }

  public async getClientAsync(): Promise<ExperimentationClient> {
    this.pending ??= this.loadAsync();
    return await this.pending;
  }
}
