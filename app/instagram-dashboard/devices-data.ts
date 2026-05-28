import { getManageData, type ManageAccount, type ManageSourceStatus } from "./manage-data";
import { getRadarData, type HealthStatus, type RadarDevice } from "./radar-data";

export type InventoryStatus = "connected" | "partial" | "pending" | "unknown";

export type DeviceHost = {
  hostId: string | null;
  hostName: string;
  hostStatus: HealthStatus;
  hostSourceLabel: string;
  phonesCount: number;
  accountsCount: number;
  lastSeenAt: string | null;
  notesStatus: string;
  sourceStatus: string;
};

export type PhoneDevice = {
  phoneId: string | null;
  phoneName: string;
  phoneStatus: HealthStatus;
  healthReason: string | null;
  hostName: string;
  accountsCount: number;
  runningAccountsCount: number | null;
  problemAccountsCount: number | null;
  lastSeenAt: string | null;
  lastRebootAt: string | null;
  sourceLabel: string;
  isInventoryPending: boolean;
};

export type PhoneAccountSummary = {
  accountId: string;
  username: string;
  healthStatus: HealthStatus;
  adminStatus: string;
  loginStatus: string;
  credentialsStatus: string;
  phoneName: string;
  hostName: string;
  lastSafeUpdate: string | null;
  sourceLabel: string;
};

export type DevicesSummary = {
  hostsCount: number;
  phonesCount: number;
  accountsAssignedCount: number;
  unknownPhoneAccountsCount: number;
  problemPhonesCount: number;
  inventoryStatus: InventoryStatus;
};

export type DevicesOverview = {
  hosts: DeviceHost[];
  phones: PhoneDevice[];
  accountsByPhone: Array<{
    phoneName: string;
    hostName: string;
    accounts: PhoneAccountSummary[];
    isInventoryPending: boolean;
  }>;
  summary: DevicesSummary;
  sourceStatus: {
    deviceInventory: ManageSourceStatus;
    accountAssignments: ManageSourceStatus;
    runtimeControls: ManageSourceStatus;
    notes: ManageSourceStatus;
  };
  errors: string[];
};

const unknownPhone = "Unknown phone";
const localMac = "Local Mac";
const accountAssignmentSource = "derived from Manage/Radar account data";

function status(label: string, description: string, code: ManageSourceStatus["status"]): ManageSourceStatus {
  return { status: code, label, description };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function accountHealth(account: ManageAccount): HealthStatus {
  const combined = normalize(`${account.adminStatus} ${account.loginStatus} ${account.credentialsStatus} ${account.latestIncidentSeverity}`);
  if (["blocked", "checkpoint", "challenge", "problem", "error", "failed"].some((term) => combined.includes(term))) return "problem";
  if (["pending", "review", "warning", "paused", "reauth", "missing"].some((term) => combined.includes(term)) || account.pendingActionsCount > 0 || account.blockingCampaign) return "monitor";
  if (["active", "ok", "configured"].some((term) => combined.includes(term))) return "ok";
  return "unknown";
}

function phoneKey(phoneName: string, hostName: string) {
  return `${hostName}:::${phoneName}`;
}

function findRadarDevice(phoneName: string, hostName: string, devices: RadarDevice[]) {
  return devices.find((device) => device.phoneName === phoneName && device.macHostName === hostName) ?? devices.find((device) => device.phoneName === phoneName);
}

function mapAccount(account: ManageAccount): PhoneAccountSummary {
  return {
    accountId: account.accountId,
    username: account.username,
    healthStatus: accountHealth(account),
    adminStatus: account.adminStatus,
    loginStatus: account.loginStatus,
    credentialsStatus: account.credentialsStatus,
    phoneName: account.phoneName || unknownPhone,
    hostName: account.macHostName || localMac,
    lastSafeUpdate: account.lastSafeUpdate,
    sourceLabel: account.sourceLabel,
  };
}

function buildPhones(accounts: PhoneAccountSummary[], radarDevices: RadarDevice[]) {
  const grouped = new Map<string, PhoneAccountSummary[]>();

  for (const account of accounts) {
    const safePhone = account.phoneName || unknownPhone;
    const safeHost = account.hostName || localMac;
    const key = phoneKey(safePhone, safeHost);
    grouped.set(key, [...(grouped.get(key) ?? []), { ...account, phoneName: safePhone, hostName: safeHost }]);
  }

  for (const device of radarDevices) {
    const key = phoneKey(device.phoneName || unknownPhone, device.macHostName || localMac);
    if (!grouped.has(key)) grouped.set(key, []);
  }

  return [...grouped.entries()].map(([key, phoneAccounts]) => {
    const [hostName, phoneName] = key.split(":::");
    const radarDevice = findRadarDevice(phoneName, hostName, radarDevices);
    const problemAccounts = phoneAccounts.filter((account) => account.healthStatus === "problem").length;
    const monitorAccounts = phoneAccounts.filter((account) => account.healthStatus === "monitor").length;
    const isUnknownPhone = phoneName === unknownPhone;
    const isInventoryPending = !radarDevice || isUnknownPhone;
    const phoneStatus: HealthStatus = radarDevice?.healthStatus ?? (problemAccounts > 0 ? "problem" : monitorAccounts > 0 ? "monitor" : isInventoryPending ? "unknown" : "ok");

    return {
      phone: {
        phoneId: radarDevice?.deviceId ?? null,
        phoneName,
        phoneStatus,
        healthReason: radarDevice?.statusLabel ?? (isInventoryPending ? "Inventory pending" : null),
        hostName,
        accountsCount: phoneAccounts.length,
        runningAccountsCount: null,
        problemAccountsCount: problemAccounts,
        lastSeenAt: radarDevice?.lastSeenAt ?? null,
        lastRebootAt: radarDevice?.lastRebootAt ?? null,
        sourceLabel: radarDevice?.sourceLabel ?? accountAssignmentSource,
        isInventoryPending,
      } satisfies PhoneDevice,
      accounts: phoneAccounts,
    };
  });
}

function buildHosts(phones: PhoneDevice[]): DeviceHost[] {
  const grouped = new Map<string, PhoneDevice[]>();

  for (const phone of phones) {
    grouped.set(phone.hostName, [...(grouped.get(phone.hostName) ?? []), phone]);
  }

  return [...grouped.entries()].map(([hostName, hostPhones]) => {
    const problemPhones = hostPhones.filter((phone) => phone.phoneStatus === "problem").length;
    const monitorPhones = hostPhones.filter((phone) => phone.phoneStatus === "monitor").length;
    const hostStatus: HealthStatus = problemPhones > 0 ? "problem" : monitorPhones > 0 ? "monitor" : hostPhones.some((phone) => !phone.isInventoryPending) ? "ok" : "unknown";

    return {
      hostId: null,
      hostName,
      hostStatus,
      hostSourceLabel: hostPhones.some((phone) => !phone.isInventoryPending) ? "Radar device source" : accountAssignmentSource,
      phonesCount: hostPhones.length,
      accountsCount: hostPhones.reduce((total, phone) => total + phone.accountsCount, 0),
      lastSeenAt: hostPhones.map((phone) => phone.lastSeenAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
      notesStatus: "Notes: pending source",
      sourceStatus: hostPhones.some((phone) => !phone.isInventoryPending) ? "partial" : "pending",
    };
  });
}

function inventoryStatus(phones: PhoneDevice[]): InventoryStatus {
  if (!phones.length) return "pending";
  if (phones.every((phone) => phone.isInventoryPending)) return "pending";
  if (phones.some((phone) => phone.isInventoryPending)) return "partial";
  return "connected";
}

export async function getDevicesData(): Promise<DevicesOverview> {
  const [manageData, radarData] = await Promise.all([getManageData(), getRadarData()]);
  const accountSummaries = manageData.allAccounts.map(mapAccount);
  const phoneGroups = buildPhones(accountSummaries, radarData.devices);
  const phones = phoneGroups.map((group) => group.phone).sort((a, b) => `${a.hostName}-${a.phoneName}`.localeCompare(`${b.hostName}-${b.phoneName}`));
  const hosts = buildHosts(phones).sort((a, b) => a.hostName.localeCompare(b.hostName));
  const statusCode = inventoryStatus(phones);
  const unknownPhoneAccountsCount = accountSummaries.filter((account) => account.phoneName === unknownPhone).length;

  return {
    hosts,
    phones,
    accountsByPhone: phoneGroups
      .map((group) => ({
        phoneName: group.phone.phoneName,
        hostName: group.phone.hostName,
        accounts: group.accounts.sort((a, b) => a.username.localeCompare(b.username)),
        isInventoryPending: group.phone.isInventoryPending,
      }))
      .sort((a, b) => `${a.hostName}-${a.phoneName}`.localeCompare(`${b.hostName}-${b.phoneName}`)),
    summary: {
      hostsCount: hosts.length,
      phonesCount: phones.length,
      accountsAssignedCount: accountSummaries.filter((account) => account.phoneName !== unknownPhone).length,
      unknownPhoneAccountsCount,
      problemPhonesCount: phones.filter((phone) => phone.phoneStatus === "problem").length,
      inventoryStatus: statusCode,
    },
    sourceStatus: {
      deviceInventory:
        statusCode === "connected"
          ? status("Device inventory connected", "Device readiness is available from current Radar device data.", "connected")
          : statusCode === "partial"
            ? status("Device inventory partial", "Some phones are derived from account assignment data while inventory remains incomplete.", "pending")
            : status("Inventory pending", "No dedicated phone or host inventory source is connected yet.", "pending"),
      accountAssignments: status(manageData.summary.sourceStatus.accounts.label, "Account phone and host labels are derived from the Manage account contract.", manageData.summary.sourceStatus.accounts.status),
      runtimeControls: status("Runtime controls disabled", "Restart, stop all, and order writes require backend support and operator approval.", "pending"),
      notes: status("Notes pending source", "Phone notes and custom order are prepared for future backend storage.", "pending"),
    },
    errors: [...manageData.errors, ...radarData.errors],
  };
}
