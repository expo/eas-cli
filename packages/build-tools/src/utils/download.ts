export function getProxiedDownloadUrl({
  directUrl,
  proxyBaseUrl,
}: {
  directUrl: string;
  proxyBaseUrl?: string;
}): string | null {
  if (!proxyBaseUrl) {
    return null;
  }

  const parsedUrl = new URL(directUrl);
  return directUrl.replace(
    `${parsedUrl.protocol}//${parsedUrl.host}`,
    `${proxyBaseUrl}/${parsedUrl.host}`
  );
}
