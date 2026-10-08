export const notificationCategories = ["incident", "new_client", "plan_change", "auto_login", "ct_lifecycle"] as const;
export const notificationChannels = ["slack", "discord"] as const;
export const notificationEnvironments = ["test", "live"] as const;

export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationChannelV2 = (typeof notificationChannels)[number];
export type NotificationEnvironment = (typeof notificationEnvironments)[number];

export type NotificationBusinessEventInput = {
  idempotencyKey: string;
  category: NotificationCategory;
  environment: NotificationEnvironment;
  eventType: string;
  accountId?: string | null;
  clientId?: string | null;
  tenantId?: string | null;
  businessPayload: Record<string, unknown>;
  technicalDiagnostics?: Record<string, unknown>;
  occurredAt?: string;
};

export type PublicDestinationSetting = {
  id: string;
  category: NotificationCategory;
  environment: NotificationEnvironment;
  channel: NotificationChannelV2;
  enabled: boolean;
  configured: boolean;
  destinationLabel: string | null;
  externalDestinationHint: string | null;
  configuredAt: string | null;
  updatedAt: string | null;
  lastSuccessAt: string | null;
  lastTestAt: string | null;
  lastErrorAt: string | null;
  lastErrorSummary: string | null;
  retryState: Record<string, unknown>;
};

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return notificationCategories.includes(String(value) as NotificationCategory);
}

export function isNotificationChannel(value: unknown): value is NotificationChannelV2 {
  return notificationChannels.includes(String(value) as NotificationChannelV2);
}

export function isNotificationEnvironment(value: unknown): value is NotificationEnvironment {
  return notificationEnvironments.includes(String(value) as NotificationEnvironment);
}
