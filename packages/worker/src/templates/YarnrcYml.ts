export const createYarnrcYml = ({ registryUrl }: { registryUrl: string }) => `
unsafeHttpWhitelist:
  - "*"
npmRegistryServer: "${registryUrl}"
enableImmutableInstalls: false
`;
