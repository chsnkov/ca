import { NextRequest, NextResponse } from 'next/server';
import { saveConfig } from '../../../lib/store';

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

    await saveConfig({
      selectedListIds,
      managedWebhooks: [],
    });

    // auto webhook recreate
    await fetch(req.nextUrl.origin + '/api/setup-webhook').catch(() => {});

    return NextResponse.redirect(new URL('/', req.url), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'config_save_failed';
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, req.url), { status: 303 });
  }
}
