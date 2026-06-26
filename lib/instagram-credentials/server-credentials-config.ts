export type ServerCredentialsConfig = {
  url: string;
  token: string;
};

function readServerEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function resolveServerCredentialsConfig(): ServerCredentialsConfig | null {
  const url = readServerEnv("INSTAGRAM_CREDENTIALS_API_URL");
  const token = readServerEnv("INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN");
  if (!url || !token) return null;
  return { url, token };
}

export function isServerCredentialsConfigured() {
  return resolveServerCredentialsConfig() !== null;
}
