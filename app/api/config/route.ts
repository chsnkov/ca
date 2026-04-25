import { NextRequest, NextResponse } from 'next/server';
import { saveConfig, appendRun } from '../../../lib/store';
import { isRequestAuthenticated, unauthorizedRedirect } from '../../../lib/auth';
import { setupWebhooks } from '../../../lib/webhooks';
import { normalizeSyncIntervalMinutes } from '../../../lib/scheduler';

export async function POST(req: NextRequest) {
  if (!isRequestAuthenticated(req)) {
    return unauthorizedRedirect(req);
  }

  try {
    const form = await req.formData();

    const raw = form.getAll('selectedListIds');
    let selectedListIds = [...new Set(raw.map(String).filter(Boolean))];

    if (!selectedListIds.length) {
      const single = form.get('selectedListIds');
      if (single) selectedListIds = [String(single)];
    }

    if (!selectedListIds.length) {
      return NextResponse.redirect(new URL('/?error=no_list_selected', req.url), { status: 303 });
    }

    const syncIntervalMinutes = normalizeSyncIntervalMinutes(form.get('syncIntervalMinutes'));

    await appendRun({
      type: 'config',
      message: 'UI LIST SELECTION',
      selectedListIds,
      syncIntervalMinutes,
      raw,
      timestamp: Date.now(),
    });

    await saveConfig({
      selectedListIds,
      syncIntervalMinutes,
      managedWebhooks: [],
    });

    try {
      const setupResult = await setupWebhooks(req.nextUrl.origin, selectedListIds, { syncIntervalMinutes });

      await appendRun({
        type: 'config',
        message: 'WEBHOOK SETUP OK',
        selectedListIds,
        syncIntervalMinutes,
        setupResult,
        timestamp: Date.now(),
      });
    } catch (e: any) {
      await appendRun({
        type: 'config',
        message: 'WEBHOOK SETUP FAILED',
        error: e?.message,
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
