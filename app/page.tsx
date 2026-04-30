import { getConfig, getStats } from '../lib/store';
import { getLists } from '../lib/clickup';
import { isAuthenticated } from '../lib/auth';
import { getScheduleSummary } from '../lib/scheduler';
import ScheduleTimer from './schedule-timer';

// noop: trigger redeploy v2
export const dynamic = 'force-dynamic';

const tashkentDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Tashkent',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

type ListItem = {
  id: string;
  name: string;
  spaceId?: string;
  spaceName?: string;
  folderId?: string | null;
  folderName?: string | null;
};

function listPath(list: ListItem) {
  return [list.spaceName, list.folderName].filter(Boolean).join(' / ');
}

function formatTashkentDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : tashkentDateFormatter.format(date);
}

type FolderGroup = {
  label: string;
  lists: ListItem[];
};

type SpaceGroup = {
  label: string;
  folders: FolderGroup[];
};

function LoginForm({ error }: { error?: string }) {
  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 420, margin: '40px auto' }}>
      <h1>Login</h1>

      {error && (
        <div style={{ background: '#300', color: '#f66', padding: 10 }}>
          Invalid credentials
        </div>
      )}

      <form method="post" action="/api/login" style={{ display: 'grid', gap: 12 }}>
        <input name="login" placeholder="Login" style={{ padding: 10 }} />
        <input name="password" type="password" placeholder="Password" style={{ padding: 10 }} />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

function Dashboard({
  stats,
  lists,
  listsError,
  selectedListIds,
  syncIntervalMinutes,
  autoSyncEnabled,
  webhookSyncEnabled,
  parentStatusSyncEnabled,
  dateStatusSyncEnabled,
  lastScheduledRunAt,
  nextScheduledRunAt,
  schedulerReady,
}: {
  stats: any;
  lists: ListItem[];
  listsError?: string;
  selectedListIds: string[];
  syncIntervalMinutes: number;
  autoSyncEnabled: boolean;
  webhookSyncEnabled: boolean;
  parentStatusSyncEnabled: boolean;
  dateStatusSyncEnabled: boolean;
  lastScheduledRunAt: string | null;
  nextScheduledRunAt: string | null;
  schedulerReady: boolean;
}) {
  const selectedLists = lists.filter(l => selectedListIds.includes(l.id));
  const groupedLists = lists.reduce<SpaceGroup[]>((groups, list) => {
    const spaceLabel = list.spaceName || 'Unsorted';
    const folderLabel = list.folderName || 'No folder';
    let space = groups.find((group) => group.label === spaceLabel);

    if (!space) {
      space = { label: spaceLabel, folders: [] };
      groups.push(space);
    }

    let folder = space.folders.find((group) => group.label === folderLabel);

    if (!folder) {
      folder = { label: folderLabel, lists: [] };
      space.folders.push(folder);
    }

    folder.lists.push(list);

    return groups;
  }, []);

  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>ClickUp Sync Dashboard</h1>
        <form method="post" action="/api/logout">
          <button type="submit">Logout</button>
        </form>
      </div>

      {listsError && (
        <section style={{ margin: '20px 0', padding: 16, border: '1px solid #92400e', background: '#331b00', color: '#fbbf24', borderRadius: 8 }}>
          <strong>ClickUp lists unavailable:</strong> {listsError}
        </section>
      )}

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #0a0', borderRadius: 8 }}>
        <h2>Active Lists ({selectedLists.length})</h2>

        {selectedLists.length === 0 && (
          <div style={{ color: '#888' }}>No lists selected</div>
        )}

        {selectedLists.map(list => (
          <div key={list.id} style={{ padding: '6px 0', borderBottom: '1px solid #222' }}>
            <strong>{list.name}</strong>
            <div style={{ fontSize: 12, color: '#888' }}>
              {listPath(list) ? `${listPath(list)} / ${list.id}` : list.id}
            </div>
          </div>
        ))}
      </section>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #333', borderRadius: 8 }}>
        <h2>Select Lists</h2>
        <form method="post" action="/api/config" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            {groupedLists.map((space) => {
              const spaceListCount = space.folders.reduce((total, folder) => total + folder.lists.length, 0);
              const selectedSpaceCount = space.folders.reduce(
                (total, folder) => total + folder.lists.filter((list) => selectedListIds.includes(list.id)).length,
                0
              );

              return (
                <details
                  key={space.label}
                  open={selectedSpaceCount > 0}
                  style={{ border: '1px solid #222', borderRadius: 6, overflow: 'hidden' }}
                >
                  <summary style={{ cursor: 'pointer', padding: 10, background: '#111827' }}>
                    <strong>{space.label}</strong>
                    <span style={{ color: '#888', marginLeft: 8 }}>
                      {selectedSpaceCount}/{spaceListCount}
                    </span>
                  </summary>
                  <div style={{ display: 'grid', gap: 8, padding: 10 }}>
                    {space.folders.map((folder) => {
                      const selectedFolderCount = folder.lists.filter((list) => selectedListIds.includes(list.id)).length;

                      return (
                        <details
                          key={folder.label}
                          open={selectedFolderCount > 0}
                          style={{ border: '1px solid #1f2937', borderRadius: 6, overflow: 'hidden' }}
                        >
                          <summary style={{ cursor: 'pointer', padding: 8, background: '#0f172a' }}>
                            <strong>{folder.label}</strong>
                            <span style={{ color: '#888', marginLeft: 8 }}>
                              {selectedFolderCount}/{folder.lists.length}
                            </span>
                          </summary>
                          <select
                            name="selectedListIds"
                            multiple
                            defaultValue={selectedListIds}
                            style={{ width: '100%', padding: 10, height: Math.min(220, Math.max(80, folder.lists.length * 34)) }}
                          >
                            {folder.lists.map((list) => (
                              <option key={list.id} value={list.id}>
                                {list.name} ({list.id})
                              </option>
                            ))}
                          </select>
                        </details>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
          <button type="submit" disabled={Boolean(listsError)}>Save Selected Lists</button>
        </form>
      </section>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #333', borderRadius: 8 }}>
        <h2>Sync</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {!schedulerReady && (
            <div style={{ background: '#331b00', color: '#fbbf24', padding: 10, border: '1px solid #92400e' }}>
              Auto sync needs ADMIN_TOKEN in Vercel production env.
            </div>
          )}
          <div style={{ border: '1px solid #1f2937', borderRadius: 8, padding: 12, display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Automation Toggles</h3>
            <form method="post" action="/api/config" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="hidden" name="configAction" value="syncToggles" />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input name="autoSyncEnabled" type="checkbox" defaultChecked={autoSyncEnabled} />
              <span>Auto sync</span>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input name="webhookSyncEnabled" type="checkbox" defaultChecked={webhookSyncEnabled} />
              <span>Webhook sync</span>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input name="parentStatusSyncEnabled" type="checkbox" defaultChecked={parentStatusSyncEnabled} />
              <span>Parent status sync</span>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input name="dateStatusSyncEnabled" type="checkbox" defaultChecked={dateStatusSyncEnabled} />
              <span>Date status sync</span>
            </label>
            <button type="submit">Save Sync Toggles</button>
            </form>
          </div>
          <form method="post" action="/api/config" style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <input type="hidden" name="configAction" value="interval" />
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Auto sync interval (minutes)</span>
              <input
                name="syncIntervalMinutes"
                type="number"
                min={5}
                max={1440}
                step={5}
                defaultValue={syncIntervalMinutes}
                style={{ padding: 10, width: 180 }}
              />
            </label>
            <button type="submit">Save Interval</button>
          </form>
          <div>
            Auto sync: <strong>{autoSyncEnabled ? `every ${syncIntervalMinutes} minutes` : 'off'}</strong>
          </div>
          <div>
            Last auto sync: <strong>{lastScheduledRunAt ? formatTashkentDate(lastScheduledRunAt) : 'never'}</strong>
          </div>
          <div>
            Next auto sync: <strong>{autoSyncEnabled ? (nextScheduledRunAt ? formatTashkentDate(nextScheduledRunAt) : 'after the next scheduler tick') : 'disabled'}</strong>
          </div>
          <div>
            Timer: <strong>{autoSyncEnabled ? <ScheduleTimer nextRunAt={nextScheduledRunAt} /> : 'disabled'}</strong>
          </div>
        </div>
        <form method="post" action="/api/run?redirect=1">
          <button type="submit">Run Full Sync</button>
        </form>
      </section>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #333', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Stats</h2>
          <form method="post" action="/api/clear-log">
            <button type="submit" style={{ background: '#300', color: '#f66', padding: '6px 12px', borderRadius: 4 }}>
              Clear Log
            </button>
          </form>
        </div>

        <pre style={{ background: '#111', color: '#0f0', padding: 16, overflowX: 'auto' }}>
          {JSON.stringify(stats, null, 2)}
        </pre>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export default async function Page(props: { searchParams?: Promise<{ error?: string }> }) {
  const isAuthed = await isAuthenticated();
  const searchParams = await props.searchParams;

  if (!isAuthed) {
    return <LoginForm error={searchParams?.error} />;
  }

  const [stats, config] = await Promise.all([
    getStats(),
    getConfig(),
  ]);

  let lists: ListItem[] = [];
  let listsError: string | undefined;

  try {
    lists = await getLists();
  } catch (error) {
    listsError = getErrorMessage(error);
    console.error('[dashboard] failed to load ClickUp lists', { error: listsError });
  }

  const selectedListIds = config?.selectedListIds || [];
  const autoSyncEnabled = config?.autoSyncEnabled !== false;
  const webhookSyncEnabled = config?.webhookSyncEnabled !== false;
  const parentStatusSyncEnabled = config?.parentStatusSyncEnabled !== false;
  const dateStatusSyncEnabled = config?.dateStatusSyncEnabled !== false;
  const schedule = getScheduleSummary(config, stats);

  return (
    <Dashboard
      stats={stats}
      lists={lists}
      listsError={listsError}
      selectedListIds={selectedListIds}
      syncIntervalMinutes={schedule.syncIntervalMinutes}
      autoSyncEnabled={autoSyncEnabled}
      webhookSyncEnabled={webhookSyncEnabled}
      parentStatusSyncEnabled={parentStatusSyncEnabled}
      dateStatusSyncEnabled={dateStatusSyncEnabled}
      lastScheduledRunAt={schedule.lastScheduledRunAt}
      nextScheduledRunAt={schedule.nextScheduledRunAt}
      schedulerReady={Boolean(process.env.ADMIN_TOKEN)}
    />
  );
}
