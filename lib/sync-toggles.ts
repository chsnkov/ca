type SyncToggleSection = {
  enabled: boolean;
  customFieldSync: boolean;
  parentStatusSync: boolean;
  dateStatusSync: boolean;
};

export type ManualSyncMode = 'smart' | 'bruteForce';

type ManualSyncToggleSection = {
  mode: ManualSyncMode;
  customFieldSync: boolean;
  parentStatusSync: boolean;
  dateStatusSync: boolean;
};

export type SyncToggles = {
  auto: SyncToggleSection;
  webhook: SyncToggleSection;
  manual: ManualSyncToggleSection;
};

function bool(value: any, fallback: boolean) {
  return value === undefined || value === null ? fallback : value !== false;
}

function effectiveSection(master: boolean, customFieldSync: boolean, parentStatusSync: boolean, dateStatusSync: boolean) {
  if (!master || (!customFieldSync && !parentStatusSync && !dateStatusSync)) {
    return {
      enabled: false,
      customFieldSync: false,
      parentStatusSync: false,
      dateStatusSync: false,
    };
  }

  return {
    enabled: true,
    customFieldSync,
    parentStatusSync,
    dateStatusSync,
  };
}

function manualMode(value: any): ManualSyncMode {
  return value === 'smart' ? 'smart' : 'bruteForce';
}

export function getSyncToggles(config: any): SyncToggles {
  const autoMaster = bool(config?.autoSyncEnabled, true);
  const webhookMaster = bool(config?.webhookSyncEnabled, true);
  const legacyParentStatus = bool(config?.parentStatusSyncEnabled, true);
  const legacyDateStatus = bool(config?.dateStatusSyncEnabled, true);

  return {
    auto: effectiveSection(
      autoMaster,
      bool(config?.autoSyncCustomFieldSyncEnabled, autoMaster),
      bool(config?.autoSyncParentStatusSyncEnabled, legacyParentStatus),
      bool(config?.autoSyncDateStatusSyncEnabled, legacyDateStatus),
    ),
    webhook: effectiveSection(
      webhookMaster,
      bool(config?.webhookCustomFieldSyncEnabled, webhookMaster),
      bool(config?.webhookParentStatusSyncEnabled, legacyParentStatus),
      bool(config?.webhookDateStatusSyncEnabled, legacyDateStatus),
    ),
    manual: {
      mode: manualMode(config?.manualSyncMode),
      customFieldSync: bool(config?.manualSyncCustomFieldSyncEnabled, true),
      parentStatusSync: bool(config?.manualSyncParentStatusSyncEnabled, legacyParentStatus),
      dateStatusSync: bool(config?.manualSyncDateStatusSyncEnabled, legacyDateStatus),
    },
  };
}

export function flattenSyncToggles(toggles: SyncToggles) {
  return {
    autoSyncEnabled: toggles.auto.enabled,
    autoSyncCustomFieldSyncEnabled: toggles.auto.customFieldSync,
    autoSyncParentStatusSyncEnabled: toggles.auto.parentStatusSync,
    autoSyncDateStatusSyncEnabled: toggles.auto.dateStatusSync,
    webhookSyncEnabled: toggles.webhook.enabled,
    webhookCustomFieldSyncEnabled: toggles.webhook.customFieldSync,
    webhookParentStatusSyncEnabled: toggles.webhook.parentStatusSync,
    webhookDateStatusSyncEnabled: toggles.webhook.dateStatusSync,
    manualSyncMode: toggles.manual.mode,
    manualSyncCustomFieldSyncEnabled: toggles.manual.customFieldSync,
    manualSyncParentStatusSyncEnabled: toggles.manual.parentStatusSync,
    manualSyncDateStatusSyncEnabled: toggles.manual.dateStatusSync,
  };
}
