import { NextRequest, NextResponse } from 'next/server';
import { saveConfig, appendRun } from '../../../lib/store';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const raw = form.getAll('selectedListIds');
    let selectedListIds = raw.map(String).filter(Boolean);

    if (!selectedListIds.length) {
      const single = form.get('selectedListIds');
      if (single) selectedListIds = [String(single)];
    }

    if (!selectedListIds.length) {
      return NextResponse.redirect(new URL('/?error=no_list_selected', req.url), { status: 303 });
    }

    await appendRun({
      type: 'config',
      message: 'UI LIST SELECTION',
      selectedListIds,
      raw,
      timestamp: Date.now(),
    });

    await saveConfig({
      selectedListIds,
      managedWebhooks: [],
    });

    try {
      await fetch(req.nextUrl.origin + '/api/setup-webhook');

      await appendRun({
        type: 'config',
        message: 'WEBHOOK SETUP OK',
        selectedListIds,
        timestamp: Date.now(),
      });
    } catch (e: any) {
      await appendRun({
        type: 'config',
        message: 'WEBHOOK SETUP FAILED',
        error: e?.message,
        selectedListIds,
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
