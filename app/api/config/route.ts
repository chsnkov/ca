import { NextRequest, NextResponse } from 'next/server';
import { saveConfig } from '../../../lib/store';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const selectedListId = String(form.get('selectedListId') || '');

  if (!selectedListId) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  await saveConfig({
    selectedListIds: [selectedListId],
  });

  return NextResponse.redirect(new URL('/', req.url));
}
