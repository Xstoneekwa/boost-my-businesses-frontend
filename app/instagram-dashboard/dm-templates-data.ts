import { createSupabaseClient } from "@/lib/supabase";

type SourceStatus = "connected" | "pending" | "unknown";
type VariableStatus = "connected" | "pending" | "unknown";
type ValidationStatus = "valid" | "warning" | "invalid" | "pending";

type SettingsRow = {
  account_id?: string | null;
  username?: string | null;
  welcome_dm_enabled?: boolean | null;
  welcome_dm_message?: string | null;
  check_chat_before_welcoming?: boolean | null;
  cold_dm_enabled?: boolean | null;
  cold_dm_message?: string | null;
  max_dm_per_run?: number | null;
  max_consecutive_dms?: number | null;
  send_enabled?: boolean | null;
  safe_review_mode?: boolean | null;
  updated_at?: string | null;
};

export type DmTemplateAccount = {
  accountId: string;
  username: string;
  clientName: string | null;
  packageLabel: string | null;
  entitlementSummary: string | null;
  sourceLabel: string;
  lastSafeUpdate: string | null;
};

export type DmTemplateItem = {
  id: string;
  accountId: string;
  username: string;
  clientName: string | null;
  templateKind: "welcome_dm" | "cold_dm";
  title: string;
  enabled: boolean;
  message: string;
  previewMessage: string;
  missingMessage: boolean;
  editableInSettings: boolean;
  clientEditableFuture: boolean;
  approvalStatus: "pending" | "approved" | "rejected" | "not_required" | "pending_backend";
  variableStatus: VariableStatus;
  validationStatus: ValidationStatus;
  validationNotes: string[];
  detectedVariables: Array<{ key: string; status: "allowed" | "pending" | "unknown" }>;
  sourceLabel: string;
  updatedAt: string | null;
  isClientEditable: boolean;
  isAdminOnly: boolean;
  pendingBackendModel: boolean;
};

export type AllowedVariable = {
  key: string;
  label: string;
  exampleValue: string;
  status: "allowed" | "pending" | "disabled";
};

export type DmTemplatesSummary = {
  accountsCount: number;
  welcomeEnabledCount: number;
  outreachEnabledCount: number;
  missingMessageCount: number;
  pendingBackendModelCount: number;
};

export type DmTemplatesSourceStatus = {
  accountSettings: SourceStatus;
  accountScopedModel: SourceStatus;
  clientApproval: SourceStatus;
  activityAudit: SourceStatus;
};

export type DmTemplatesOverview = {
  accounts: DmTemplateAccount[];
  templates: DmTemplateItem[];
  summary: DmTemplatesSummary;
  sourceStatus: DmTemplatesSourceStatus;
  sourceDetails: Record<keyof DmTemplatesSourceStatus, { label: string; description: string }>;
  allowedVariables: AllowedVariable[];
};

export const allowedDmVariables: AllowedVariable[] = [
  { key: "username", label: "Instagram username", exampleValue: "boost_account", status: "allowed" },
  { key: "client_name", label: "Client name", exampleValue: "Example Client", status: "allowed" },
  { key: "business_name", label: "Business name", exampleValue: "Example Business", status: "allowed" },
  { key: "city", label: "City", exampleValue: "Example City", status: "allowed" },
  { key: "custom_offer", label: "Custom offer", exampleValue: "Example Offer", status: "allowed" },
  { key: "first_name", label: "First name", exampleValue: "Alex", status: "pending" },
];

const allowedVariableMap = new Map(allowedDmVariables.map((variable) => [variable.key, variable]));

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function detectVariables(message: string) {
  const matches = [...message.matchAll(/\{([a-zA-Z0-9_]+)\}/g)];
  const keys = [...new Set(matches.map((match) => match[1]))];

  return keys.map((key) => {
    const variable = allowedVariableMap.get(key);
    return {
      key,
      status: variable?.status === "allowed" ? "allowed" as const : variable?.status === "pending" ? "pending" as const : "unknown" as const,
    };
  });
}

function previewMessage(message: string, account: DmTemplateAccount) {
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    if (key === "username") return account.username;
    if (key === "client_name") return account.clientName || "Example Client";

    const variable = allowedVariableMap.get(key);
    if (!variable || variable.status === "disabled") return match;
    return variable.exampleValue;
  });
}

function validateMessage(enabled: boolean, message: string, variables: ReturnType<typeof detectVariables>) {
  const notes: string[] = [];

  if (enabled && !message.trim()) {
    notes.push("Enabled but message is empty.");
  }
  if (!enabled && message.trim()) {
    notes.push("Disabled template has saved message text.");
  }
  if (message.length > 1000) {
    notes.push("Message is longer than 1000 characters.");
  }

  const unknownVariables = variables.filter((variable) => variable.status === "unknown");
  if (unknownVariables.length) {
    notes.push(`Unknown variable: ${unknownVariables.map((variable) => `{${variable.key}}`).join(", ")}`);
  }

  if (enabled && !message.trim()) return { status: "invalid" as const, notes };
  if (message.length > 1000 || unknownVariables.length || notes.length) return { status: "warning" as const, notes };
  if (!message.trim()) return { status: "pending" as const, notes: ["Message source is empty."] };
  return { status: "valid" as const, notes };
}

function variableStatus(variables: ReturnType<typeof detectVariables>): VariableStatus {
  if (variables.some((variable) => variable.status === "unknown")) return "unknown";
  if (variables.some((variable) => variable.status === "pending")) return "pending";
  return "connected";
}

function mapRow(row: SettingsRow): { account: DmTemplateAccount; templates: DmTemplateItem[] } {
  const accountId = readString(row.account_id, "");
  const username = readString(row.username, "unknown_account") || "unknown_account";
  const updatedAt = readString(row.updated_at, "") || null;
  const account: DmTemplateAccount = {
    accountId,
    username,
    clientName: null,
    packageLabel: null,
    entitlementSummary: null,
    sourceLabel: "ig_account_settings",
    lastSafeUpdate: updatedAt,
  };

  const welcomeMessage = readString(row.welcome_dm_message, "");
  const outreachMessage = readString(row.cold_dm_message, "");
  const welcomeVariables = detectVariables(welcomeMessage);
  const outreachVariables = detectVariables(outreachMessage);
  const welcomeEnabled = readBoolean(row.welcome_dm_enabled, false);
  const outreachEnabled = readBoolean(row.cold_dm_enabled, false);
  const welcomeValidation = validateMessage(welcomeEnabled, welcomeMessage, welcomeVariables);
  const outreachValidation = validateMessage(outreachEnabled, outreachMessage, outreachVariables);

  return {
    account,
    templates: [
      {
        id: `${accountId}:welcome_dm`,
        accountId,
        username,
        clientName: account.clientName,
        templateKind: "welcome_dm",
        title: "Welcome DM",
        enabled: welcomeEnabled,
        message: welcomeMessage,
        previewMessage: previewMessage(welcomeMessage, account),
        missingMessage: welcomeEnabled && !welcomeMessage.trim(),
        editableInSettings: true,
        clientEditableFuture: true,
        approvalStatus: "pending_backend",
        variableStatus: variableStatus(welcomeVariables),
        validationStatus: welcomeValidation.status,
        validationNotes: welcomeValidation.notes,
        detectedVariables: welcomeVariables,
        sourceLabel: "ig_account_settings",
        updatedAt,
        isClientEditable: false,
        isAdminOnly: true,
        pendingBackendModel: true,
      },
      {
        id: `${accountId}:cold_dm`,
        accountId,
        username,
        clientName: account.clientName,
        templateKind: "cold_dm",
        title: "Cold / Outreach DM",
        enabled: outreachEnabled,
        message: outreachMessage,
        previewMessage: previewMessage(outreachMessage, account),
        missingMessage: outreachEnabled && !outreachMessage.trim(),
        editableInSettings: true,
        clientEditableFuture: true,
        approvalStatus: "pending_backend",
        variableStatus: variableStatus(outreachVariables),
        validationStatus: outreachValidation.status,
        validationNotes: outreachValidation.notes,
        detectedVariables: outreachVariables,
        sourceLabel: "ig_account_settings",
        updatedAt,
        isClientEditable: false,
        isAdminOnly: true,
        pendingBackendModel: true,
      },
    ],
  };
}

function emptyOverview(sourceStatus: DmTemplatesSourceStatus["accountSettings"] = "unknown"): DmTemplatesOverview {
  return {
    accounts: [],
    templates: [],
    summary: {
      accountsCount: 0,
      welcomeEnabledCount: 0,
      outreachEnabledCount: 0,
      missingMessageCount: 0,
      pendingBackendModelCount: 0,
    },
    sourceStatus: {
      accountSettings: sourceStatus,
      accountScopedModel: "pending",
      clientApproval: "pending",
      activityAudit: "pending",
    },
    sourceDetails: {
      accountSettings: {
        label: sourceStatus === "connected" ? "ig_account_settings ready" : "Settings source pending",
        description: "Safe projection from ig_account_settings DM columns only.",
      },
      accountScopedModel: {
        label: "Pending backend",
        description: "Dedicated account/client-scoped DM message model is not connected yet. This view does not use global templates as the source.",
      },
      clientApproval: {
        label: "Pending backend",
        description: "Client/admin approval workflow is not connected yet.",
      },
      activityAudit: {
        label: "Pending backend",
        description: "DM template changes are not written to Activity Log yet.",
      },
    },
    allowedVariables: allowedDmVariables,
  };
}

export async function getDmTemplatesData(): Promise<DmTemplatesOverview> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_account_settings")
    .select("account_id, username, welcome_dm_enabled, welcome_dm_message, check_chat_before_welcoming, cold_dm_enabled, cold_dm_message, max_dm_per_run, max_consecutive_dms, send_enabled, safe_review_mode, updated_at")
    .order("username", { ascending: true });

  if (error) {
    return emptyOverview("unknown");
  }

  const mapped = ((data ?? []) as SettingsRow[]).filter((row) => readString(row.account_id, "")).map(mapRow);
  const accounts = mapped.map((item) => item.account);
  const templates = mapped.flatMap((item) => item.templates);

  // TODO: Replace this legacy projection with dedicated account/client-scoped DM
  // messages, optional admin suggestion drafts, versioning, approval, Activity Log
  // audit, and BotApp/admin/client sync. Do not make global templates the source
  // of truth for personalized client/account messages.
  return {
    ...emptyOverview("connected"),
    accounts,
    templates,
    summary: {
      accountsCount: accounts.length,
      welcomeEnabledCount: templates.filter((template) => template.templateKind === "welcome_dm" && template.enabled).length,
      outreachEnabledCount: templates.filter((template) => template.templateKind === "cold_dm" && template.enabled).length,
      missingMessageCount: templates.filter((template) => template.missingMessage).length,
      pendingBackendModelCount: templates.filter((template) => template.pendingBackendModel).length,
    },
  };
}
