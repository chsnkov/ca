import { NextRequest, NextResponse } from 'next/server';
import { saveConfig } from '../../../lib/store';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const selectedListId = String(form.get('selectedListId') || '');

    if (!selectedListId) {
      return NextResponse.redirect(new URL('/?error=no_list_selected', req.url), { status: 303 });
    }

    await saveConfig({
      selectedListIds: [selectedListId],
      managedWebhooks: [],
    });

    return NextResponse.redirect(new URL('/', req.url), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'config_save_failed';
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, req.url), { status: 303 });
  }
}
