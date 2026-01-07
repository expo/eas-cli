export async function uploadApplicationArchiveAsync(): Promise<string> {
  return 'https://expo.dev/artifacts/application.tar.gz';
}

export async function uploadBuildArtifactsAsync(): Promise<string> {
  return 'https://expo.dev/artifacts/lol.tar.gz';
}

export async function uploadWithAnalyticsAsync(fnAsync: () => Promise<string>): Promise<string> {
  return await fnAsync();
}
