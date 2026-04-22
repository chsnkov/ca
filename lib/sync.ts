type RunKind = 'manual' | 'webhook' | 'scheduled';

export type SyncResult = {
  ok: boolean;
  kind: RunKind;
  startedAt: string;
  finishedAt: string;
  message: string;
};

async function run(kind: RunKind): Promise<SyncResult> {
  const startedAt = new Date().toISOString();

  // TODO: wire ClickUp sync logic here.
  const finishedAt = new Date().toISOString();

  return {
    ok: true,
    kind,
    startedAt,
    finishedAt,
    message: 'Sync stub executed successfully.'
  };
}

export async function syncAll() {
  return run('scheduled');
}

export async function syncManual() {
  return run('manual');
}

export async function syncFromWebhook() {
  return run('webhook');
}
