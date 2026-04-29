import { NextRequest, NextResponse } from 'next/server';
import { getConfig, saveConfig, appendRun } from '../../../lib/store';
import { isRequestAuthenticated, unauthorizedRedirect } from '../../../lib/auth';
import { setupWebhooks } from '../../../lib/webhooks';
import { normalizeSyncIntervalMinutes } from '../../../lib/scheduler';

function withoutLegacyInterval(config: any) {
  const { autoSyncIntervalMinutes: _legacyAutoSyncIntervalMinutes, ...rest } = config || {};
  return rest;
}

function isChecked(value: FormDataEntryValue | null) {
  return value === 'on' || value === 'true' || value === '1';
}

export async function POST(req: NextRequest) {
  if (!isRequestAuthenticated(req)) {
    return unauthorizedRedirect(req);
  }

  try {
    const form = await req.formData();
    const currentConfig = await getConfig();
    const baseConfig = withoutLegacyInterval(currentConfig);
    const action = String(form.get('configAction') || 'lists');
    const raw = form.getAll('selectedListIds');
    let selectedListIds = [...new Set(raw.map(String).filter(Boolean))];

    if (!selectedListIds.length) {
      const single = form.get('selectedListIds');
      if (single) selectedListIds = [String(single)];
    }

    if (action === 'syncToggles') {
      const autoSyncEnabled = isChecked(form.get('autoSyncEnabled'));
      const webhookSyncEnabled = isChecked(form.get('webhookSyncEnabled'));
      const parentStatusSyncEnabled = isChecked(form.get('parentStatusSyncEnabled'));
      const wasWebhookSyncEnabled = currentConfig?.webhookSyncEnabled !== false;
      const existingListIds = Array.isArray(currentConfig?.selectedListIds)
        ? currentConfig.selectedListIds.map(String).filter(Boolean)
        : [];
      const syncIntervalMinutes = normalizeSyncIntervalMinutes(
        currentConfig?.syncIntervalMinutes ?? currentConfig?.autoSyncIntervalMinutes,
      );
      const nextConfig = {
        ...baseConfig,
        selectedListIds: existingListIds,
        syncIntervalMinutes,
        autoSyncEnabled,
        webhookSyncEnabled,
        parentStatusSyncEnabled,
        autoSync: autoSyncEnabled
          ? baseConfig.autoSync
          : { status: 'idle', disabledAt: new Date().toISOString() },
      };

      if (webhookSyncEnabled && !wasWebhookSyncEnabled) {
        try {
          const setupResult = await setupWebhooks(req.nextUrl.origin, existingListIds, nextConfig);

          await appendRun({
            type: 'config',
            message: 'WEBHOOK SETUP OK',
            reason: 'webhook_sync_enabled',
            selectedListIds: existingListIds,
            syncIntervalMinutes,
            autoSyncEnabled,
            webhookSyncEnabled,
            parentStatusSyncEnabled,
            setupResult,
            timestamp: Date.now(),
          });
        } catch (e: any) {
          await saveConfig({
            ...nextConfig,
            webhookSyncEnabled: false,
          });

          await appendRun({
            type: 'config',
            message: 'WEBHOOK SETUP FAILED',
            reason: 'webhook_sync_enable_failed',
            error: e?.message,
            selectedListIds: existingListIds,
            syncIntervalMinutes,
            autoSyncEnabled,
            webhookSyncEnabled: false,
            parentStatusSyncEnabled,
            timestamp: Date.now(),
          });
        }
      } else {
        await saveConfig(nextConfig);
      }

      await appendRun({
        type: 'config',
        message: 'SYNC TOGGLES UPDATED',
        selectedListIds: existingListIds,
        syncIntervalMinutes,
        autoSyncEnabled,
        webhookSyncEnabled,
        parentStatusSyncEnabled,
        timestamp: Date.now(),
      });

      return NextResponse.redirect(new URL('/', req.url), { status: 303 });
    }

    if (action === 'interval') {
      const syncIntervalMinutes = normalizeSyncIntervalMinutes(form.get('syncIntervalMinutes'));
      const existingListIds = Array.isArray(currentConfig?.selectedListIds)
        ? currentConfig.selectedListIds.map(String).filter(Boolean)
        : [];

      await saveConfig({
        ...baseConfig,
        selectedListIds: existingListIds,
        syncIntervalMinutes,
      });

      await appendRun({
        type: 'config',
        message: 'SYNC INTERVAL UPDATED',
        selectedListIds: existingListIds,
        syncIntervalMinutes,
        timestamp: Date.now(),
      });

      return NextResponse.redirect(new URL('/', req.url), { status: 303 });
    }

    if (!selectedListIds.length) {
      return NextResponse.redirect(new URL('/?error=no_list_selected', req.url), { status: 303 });
    }

    const syncIntervalMinutes = normalizeSyncIntervalMinutes(
      form.get('syncIntervalMinutes') ?? currentConfig?.syncIntervalMinutes ?? currentConfig?.autoSyncIntervalMinutes,
    );

    await appendRun({
      type: 'config',
      message: 'UI LIST SELECTION',
      selectedListIds,
      syncIntervalMinutes,
      raw,
      timestamp: Date.now(),
    });

    if (baseConfig.webhookSyncEnabled !== false) {
      try {
        const setupResult = await setupWebhooks(req.nextUrl.origin, selectedListIds, {
          ...baseConfig,
          selectedListIds,
          syncIntervalMinutes,
          managedWebhooks: [],
        });

        await appendRun({
          type: 'config',
          message: 'WEBHOOK SETUP OK',
          selectedListIds,
          syncIntervalMinutes,
          setupResult,
          timestamp: Date.now(),
        });
      } catch (e: any) {
        await saveConfig({
          ...baseConfig,
          selectedListIds,
          syncIntervalMinutes,
          managedWebhooks: [],
        });

        await appendRun({
          type: 'config',
          message: 'WEBHOOK SETUP FAILED',
          error: e?.message,
          selectedListIds,
          syncIntervalMinutes,
          timestamp: Date.now(),
        });
      }
    } else {
      await saveConfig({
        ...baseConfig,
        selectedListIds,
        syncIntervalMinutes,
      });

      await appendRun({
        type: 'config',
        message: 'WEBHOOK SETUP SKIPPED',
        reason: 'webhook_sync_disabled',
        selectedListIds,
        syncIntervalMinutes,
        timestamp: Date.now(),
      });
    }

    return NextResponse.redirect(new URL('/', req.url), { status: 303 });
  } catch (error: any) {
    await appendRun({
      type: 'config',
      message: 'CONFIG SAVE FAILED',
      error: error?.message,
      timestamp: Date.now(),
    });

    const message = error instanceof Error ? error.message : 'config_save_failed';
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, req.url), { status: 303 });
  }
}
