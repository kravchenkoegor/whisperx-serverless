export class MissingEnvError extends Error {
  constructor(public readonly variable: string) {
    super(`Missing environment variable ${variable}`);
    this.name = "MissingEnvError";
  }
}

function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new MissingEnvError(name);
  return value;
}

function appUrl(): string | null {
  const explicit = optional("APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelHost = optional("VERCEL_PROJECT_PRODUCTION_URL");
  return vercelHost ? `https://${vercelHost}` : null;
}

export const env = {
  r2AccountId: () => required("R2_ACCOUNT_ID"),
  r2AccessKeyId: () => required("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: () => required("R2_SECRET_ACCESS_KEY"),
  r2Bucket: () => required("R2_BUCKET"),
  runpodApiKey: () => required("RUNPOD_API_KEY"),
  runpodEndpointId: () => required("RUNPOD_ENDPOINT_ID"),
  appPassword: () => required("APP_PASSWORD"),
  sessionSecret: () => required("SESSION_SECRET"),
  webhookSecret: () => optional("WEBHOOK_SECRET"),
  appUrl,
  isProduction: () => process.env.NODE_ENV === "production",
};
