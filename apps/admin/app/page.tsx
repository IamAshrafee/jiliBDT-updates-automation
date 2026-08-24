'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Slot = 'UPDATE_1' | 'UPDATE_2' | 'UPDATE_3';
type Classification = 'COMPLETE' | 'MISSING' | 'EXEMPT' | 'UNKNOWN';
type View =
  | 'dashboard'
  | 'runs'
  | 'members'
  | 'telegram'
  | 'schedules'
  | 'templates'
  | 'history'
  | 'settings';

interface MemberResult {
  caller: string;
  sourceRow: number;
  classification: Classification;
  reasons: string[];
}

interface RunResult {
  completion: { members: MemberResult[]; counts: Record<Classification, number> };
  warnings: Array<{ code: string; severity: string; message: string }>;
  structuralHealth: { healthy: boolean; headerRowIndex?: number };
  snapshotHash: string;
}

interface Run {
  id: string;
  reportDate: string;
  updateSlot: Slot;
  triggerSource: string;
  status: string;
  previewState: string;
  latestFetchAt?: string;
  lastCheckedAt?: string;
  nextActionAt?: string;
  snapshotHash?: string;
  artifactHash?: string;
  approvalPayloadHash?: string;
  failureCode?: string;
  failureReason?: string;
  screenshotArtifactPath?: string;
  caption?: string;
  missingMembers?: string[];
  completedMembers?: string[];
  exemptMembers?: string[];
  unknownMembers?: string[];
  result?: RunResult;
}

interface Member {
  id: string;
  sheetCallerName: string;
  displayName?: string;
  telegramUsername?: string;
  telegramUserId?: string;
  mappingStatus: string;
  enabled: boolean;
  notes?: string;
  lastSeenAt?: string;
}

interface Destination {
  id: string;
  name: string;
  chatId: string;
  topicId?: number;
  destinationType: string;
  enabled: boolean;
  sendReminders: boolean;
  sendFinalReports: boolean;
}

interface Schedule {
  updateSlot: Slot;
  enabled: boolean;
  localTime: string;
  timezone: string;
  lastRunDate?: string;
}

interface Reminder {
  id: string;
  stage: string;
  status: string;
  targetMembers: string[];
  messageText: string;
  targetHash: string;
  messageHash: string;
}

interface EventRecord {
  id: string;
  eventType: string;
  message: string;
  createdAt: string;
}

interface Delivery {
  id: string;
  kind: string;
  status: string;
  destinationId: string;
  telegramMessageId?: string;
  lastError?: string;
}

interface RunDetail {
  run: Run;
  reminder?: Reminder;
  events: EventRecord[];
  deliveries: Delivery[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4100';
const views: Array<{ id: View; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'runs', label: 'Update Run' },
  { id: 'members', label: 'Members' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'templates', label: 'Templates' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];
const slotLabels: Record<Slot, string> = {
  UPDATE_1: '1st Update',
  UPDATE_2: '2nd Update',
  UPDATE_3: '3rd Update',
};

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

export default function AdminPortal() {
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<View>('dashboard');
  const [message, setMessage] = useState('Loading…');
  const [busy, setBusy] = useState(false);
  const [dashboard, setDashboard] = useState<Record<string, unknown>>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<RunDetail>();
  const [members, setMembers] = useState<Member[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [templates, setTemplates] = useState({
    initialReminder: '',
    escalationReminder: '',
    finalCaption: '',
  });
  const [telegramHealth, setTelegramHealth] = useState<Record<string, unknown>>();
  const [botHealth, setBotHealth] = useState<Record<string, unknown>>();
  const [dialogs, setDialogs] = useState<
    Array<{ chatId: string; title: string; type: string; isForum: boolean }>
  >([]);
  const [settings, setSettings] = useState<Record<string, unknown>>();
  const [imageUrl, setImageUrl] = useState<string>();
  const [memberSearch, setMemberSearch] = useState('');
  const [telegramForm, setTelegramForm] = useState({ phone: '', code: '', password: '' });
  const [destinationForm, setDestinationForm] = useState({ name: '', chatId: '', topicId: '' });

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    const body = (await response.json()) as T & { error?: string };
    if (response.status === 401) setAuthenticated(false);
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
    return body;
  }, []);

  const loadRun = useCallback(
    async (id: string) => {
      const response = await request<RunDetail>(`/api/runs/${id}`);
      setDetail(response);
      return response;
    },
    [request],
  );

  const loadRuns = useCallback(async () => {
    const response = await request<{ runs: Run[] }>('/api/runs?limit=200');
    setRuns(response.runs);
  }, [request]);

  const refreshData = useCallback(async () => {
    const [
      dashboardData,
      runData,
      memberData,
      destinationData,
      scheduleData,
      templateData,
      accountData,
      botData,
      settingsData,
    ] = await Promise.all([
      request<Record<string, unknown>>('/api/dashboard'),
      request<{ runs: Run[] }>('/api/runs?limit=200'),
      request<{ members: Member[] }>('/api/members'),
      request<{ destinations: Destination[] }>('/api/telegram/destinations'),
      request<{ schedules: Schedule[] }>('/api/schedules'),
      request<typeof templates>('/api/templates'),
      request<Record<string, unknown>>('/api/telegram/account/health'),
      request<Record<string, unknown>>('/api/telegram/bot/health'),
      request<Record<string, unknown>>('/api/settings/summary'),
    ]);
    setDashboard(dashboardData);
    setRuns(runData.runs);
    setMembers(memberData.members);
    setDestinations(destinationData.destinations);
    setSchedules(scheduleData.schedules);
    setTemplates(templateData);
    setTelegramHealth(accountData);
    setBotHealth(botData);
    setSettings(settingsData);
    setMessage('Current data loaded.');
  }, [request]);

  useEffect(() => {
    void request<{ authenticated: boolean }>('/api/auth/session')
      .then((session) => {
        setAuthenticated(session.authenticated);
        if (!session.authenticated) setMessage('');
      })
      .catch(() => {
        setAuthenticated(false);
        setMessage('The backend is unavailable.');
      });
  }, [request]);

  useEffect(() => {
    if (!authenticated) return;
    void refreshData();
    const timer = window.setInterval(() => {
      void loadRuns();
      if (detail) void loadRun(detail.run.id);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, detail?.run.id, loadRun, loadRuns, refreshData]);

  useEffect(() => {
    if (!detail?.run.screenshotArtifactPath) {
      setImageUrl(undefined);
      return;
    }
    let url: string | undefined;
    void fetch(`${API_URL}/api/runs/${detail.run.id}/artifact`, { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('Screenshot could not be loaded.');
        return response.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : 'Preview failed.'),
      );
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [detail?.run.id, detail?.run.screenshotArtifactPath]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setPassword('');
      setAuthenticated(true);
      setMessage('Signed in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST', body: '{}' });
    setAuthenticated(false);
    setDetail(undefined);
  }

  async function prepare(slot: Slot) {
    await act('Preparation started.', async () => {
      const response = await request<{ run: Run }>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({ slot, triggerSource: 'DASHBOARD' }),
      });
      await loadRun(response.run.id);
      setView('runs');
      await loadRuns();
    });
  }

  async function runAction(path: string, body: unknown = {}) {
    if (!detail) return;
    await act('Action completed.', async () => {
      await request(`/api/runs/${detail.run.id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await loadRun(detail.run.id);
      await loadRuns();
    });
  }

  async function act(success: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  }

  const filteredMembers = useMemo(
    () =>
      members.filter((member) =>
        member.sheetCallerName.toLowerCase().includes(memberSearch.toLowerCase()),
      ),
    [memberSearch, members],
  );

  if (authenticated === undefined)
    return (
      <main>
        <section className="panel">Loading administrator portal…</section>
      </main>
    );
  if (!authenticated) {
    return (
      <main className="login-page">
        <form className="panel login-card" onSubmit={(event) => void login(event)}>
          <p className="eyebrow">JILIBDT · PRIVATE ADMIN</p>
          <h1>Sign in</h1>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy}>Sign in</button>
          <p className="message">{message}</p>
        </form>
      </main>
    );
  }

  return (
    <main>
      <header className="app-header">
        <div>
          <p className="eyebrow">JILIBDT UPDATES AUTOMATION</p>
          <h1>Operations</h1>
        </div>
        <button className="secondary" onClick={() => void logout()}>
          Logout
        </button>
      </header>
      <nav className="tabs" aria-label="Administrator sections">
        {views.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? 'active' : ''}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <p className="status-message">{message}</p>

      {view === 'dashboard' && (
        <Dashboard
          dashboard={dashboard}
          runs={runs}
          schedules={schedules}
          busy={busy}
          prepare={prepare}
          openRun={(id) => {
            void loadRun(id);
            setView('runs');
          }}
        />
      )}
      {view === 'runs' && (
        <RunView
          detail={detail}
          runs={runs}
          imageUrl={imageUrl}
          busy={busy}
          openRun={(id) => void loadRun(id)}
          action={runAction}
          editReminder={(messageText) =>
            act('Reminder updated.', async () => {
              if (!detail) return;
              await request(`/api/runs/${detail.run.id}/reminder`, {
                method: 'PATCH',
                body: JSON.stringify({ message: messageText }),
              });
              await loadRun(detail.run.id);
            })
          }
        />
      )}
      {view === 'members' && (
        <MembersView
          members={filteredMembers}
          search={memberSearch}
          setSearch={setMemberSearch}
          sync={() =>
            act('Members synchronized from all three Sheet slots.', async () => {
              await request('/api/members/sync', { method: 'POST', body: '{}' });
              const response = await request<{ members: Member[] }>('/api/members');
              setMembers(response.members);
            })
          }
          save={(id, patch) =>
            act('Member mapping saved.', async () => {
              await request(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
              const response = await request<{ members: Member[] }>('/api/members');
              setMembers(response.members);
            })
          }
        />
      )}
      {view === 'telegram' && (
        <TelegramView
          health={telegramHealth}
          bot={botHealth}
          form={telegramForm}
          setForm={setTelegramForm}
          destinations={destinations}
          dialogs={dialogs}
          destinationForm={destinationForm}
          setDestinationForm={setDestinationForm}
          action={(path, body) =>
            act('Telegram action completed.', async () => {
              const response = await request<Record<string, unknown>>(`/api/telegram/${path}`, {
                method: 'POST',
                body: JSON.stringify(body),
              });
              setMessage(JSON.stringify(response));
              setTelegramHealth(await request('/api/telegram/account/health'));
            })
          }
          discover={() =>
            act('Telegram dialogs loaded.', async () => {
              const response = await request<{ dialogs: typeof dialogs }>('/api/telegram/dialogs');
              setDialogs(response.dialogs);
            })
          }
          saveDestination={() =>
            act('Destination saved.', async () => {
              await request('/api/telegram/destinations', {
                method: 'POST',
                body: JSON.stringify({
                  name: destinationForm.name,
                  chatId: destinationForm.chatId,
                  topicId: destinationForm.topicId ? Number(destinationForm.topicId) : null,
                  destinationType: 'GROUP',
                  enabled: true,
                  sendReminders: true,
                  sendFinalReports: true,
                }),
              });
              setDestinations(
                (await request<{ destinations: Destination[] }>('/api/telegram/destinations'))
                  .destinations,
              );
            })
          }
        />
      )}
      {view === 'schedules' && (
        <SchedulesView
          schedules={schedules}
          save={(schedule) =>
            act('Schedule saved.', async () => {
              await request(`/api/schedules/${schedule.updateSlot}`, {
                method: 'PUT',
                body: JSON.stringify(schedule),
              });
              setSchedules((await request<{ schedules: Schedule[] }>('/api/schedules')).schedules);
            })
          }
        />
      )}
      {view === 'templates' && (
        <TemplatesView
          templates={templates}
          setTemplates={setTemplates}
          save={() =>
            act('Templates saved.', async () => {
              await request('/api/templates', { method: 'PUT', body: JSON.stringify(templates) });
            })
          }
        />
      )}
      {view === 'history' && (
        <HistoryView
          runs={runs}
          open={(id) => {
            void loadRun(id);
            setView('runs');
          }}
        />
      )}
      {view === 'settings' && (
        <section className="panel">
          <h2>Settings summary</h2>
          <pre>{JSON.stringify(settings, null, 2)}</pre>
          <button onClick={() => void refreshData()}>Refresh all</button>
        </section>
      )}
    </main>
  );
}

function Dashboard({
  dashboard,
  runs,
  schedules,
  busy,
  prepare,
  openRun,
}: {
  dashboard?: Record<string, unknown>;
  runs: Run[];
  schedules: Schedule[];
  busy: boolean;
  prepare: (slot: Slot) => Promise<void>;
  openRun: (id: string) => void;
}) {
  const today = textValue(dashboard?.date, 'Today');
  return (
    <>
      <section className="health-grid">
        <article className="panel">
          <span>Google Sheet</span>
          <strong>
            {String(
              (dashboard?.sheet as { healthy?: boolean } | undefined)?.healthy
                ? 'Connected'
                : 'Needs attention',
            )}
          </strong>
        </article>
        <article className="panel">
          <span>Telegram Account</span>
          <strong>
            {String(
              (dashboard?.telegram as { state?: string } | undefined)?.state ?? 'Not configured',
            )}
          </strong>
        </article>
        <article className="panel">
          <span>Admin Bot</span>
          <strong>
            {String(
              (dashboard?.bot as { connected?: boolean } | undefined)?.connected
                ? 'Connected'
                : 'Not connected',
            )}
          </strong>
        </article>
      </section>
      <section>
        <div className="section-title">
          <div>
            <p className="eyebrow">{today}</p>
            <h2>Today&apos;s updates</h2>
          </div>
        </div>
        <div className="slot-grid">
          {(['UPDATE_1', 'UPDATE_2', 'UPDATE_3'] as const).map((slot) => {
            const run = runs.find(
              (candidate) => candidate.reportDate === today && candidate.updateSlot === slot,
            );
            const schedule = schedules.find((candidate) => candidate.updateSlot === slot);
            return (
              <article className="panel slot-card" key={slot}>
                <h3>{slotLabels[slot]}</h3>
                <p className="run-status">{run?.status ?? 'NOT STARTED'}</p>
                <div className="mini-metrics">
                  <span>
                    Complete <b>{run?.completedMembers?.length ?? '—'}</b>
                  </span>
                  <span>
                    Missing <b>{run?.missingMembers?.length ?? '—'}</b>
                  </span>
                  <span>
                    Day Off <b>{run?.exemptMembers?.length ?? '—'}</b>
                  </span>
                </div>
                <p className="muted">
                  Schedule: {schedule?.enabled ? schedule.localTime : 'disabled'}
                  <br />
                  Last checked: {formatDate(run?.lastCheckedAt)}
                </p>
                {run ? (
                  <button onClick={() => openRun(run.id)}>Review</button>
                ) : (
                  <button disabled={busy} onClick={() => void prepare(slot)}>
                    Prepare
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function RunView({
  detail,
  runs,
  imageUrl,
  busy,
  openRun,
  action,
  editReminder,
}: {
  detail?: RunDetail;
  runs: Run[];
  imageUrl?: string;
  busy: boolean;
  openRun: (id: string) => void;
  action: (path: string, body?: unknown) => Promise<void>;
  editReminder: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  useEffect(
    () => setDraft(detail?.reminder?.messageText ?? ''),
    [detail?.reminder?.id, detail?.reminder?.messageText],
  );
  if (!detail)
    return (
      <section className="panel">
        <h2>Select an update run</h2>
        <RunTable runs={runs} open={openRun} />
      </section>
    );
  const run = detail.run;
  const counts = run.result?.completion.counts;
  return (
    <>
      <section className="panel run-heading">
        <div>
          <p className="eyebrow">
            {run.reportDate} · {slotLabels[run.updateSlot]} · {run.triggerSource}
          </p>
          <h2>{run.status}</h2>
          <p>
            Preview: <b>{run.previewState}</b> · Last checked: {formatDate(run.lastCheckedAt)}
          </p>
          {run.failureReason && (
            <p className="error-text">
              {run.failureCode}: {run.failureReason}
            </p>
          )}
        </div>
        <div className="actions">
          <button disabled={busy} onClick={() => void action('recheck')}>
            Recheck
          </button>
          <button disabled={busy || !run.snapshotHash} onClick={() => void action('revalidate')}>
            Revalidate
          </button>
          {run.status === 'NEEDS_ATTENTION' &&
            detail.reminder &&
            ['FAILED', 'PARTIAL'].includes(detail.reminder.status) && (
              <button onClick={() => void action('reminder/retry')}>Review reminder retry</button>
            )}
          {run.status === 'NEEDS_ATTENTION' &&
            run.failureCode === 'TELEGRAM_SEND_FAILED' &&
            run.approvalPayloadHash && (
              <button onClick={() => void action('retry-final')}>Approve final retry</button>
            )}
          <button className="danger" disabled={busy} onClick={() => void action('cancel')}>
            Cancel
          </button>
        </div>
      </section>
      {counts && (
        <section className="metrics">
          {(['COMPLETE', 'MISSING', 'EXEMPT', 'UNKNOWN'] as const).map((key) => (
            <article className={`metric ${key.toLowerCase()}`} key={key}>
              <span>{key}</span>
              <strong>{counts[key]}</strong>
            </article>
          ))}
        </section>
      )}
      {detail.reminder && (
        <section className="panel reminder">
          <div>
            <p className="eyebrow">
              {detail.reminder.stage} REMINDER · {detail.reminder.status}
            </p>
            <h3>Exact reminder preview</h3>
            <p>Targets: {detail.reminder.targetMembers.join(', ')}</p>
          </div>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="actions">
            <button className="secondary" onClick={() => void editReminder(draft)}>
              Save text
            </button>
            <button
              disabled={busy || detail.reminder.status !== 'DRAFT'}
              onClick={() => void action('reminder/approve')}
            >
              Approve &amp; Send
            </button>
            <button
              className="secondary"
              onClick={() =>
                void action('skip-reminder', {
                  reason: 'Administrator explicitly skipped this stage.',
                })
              }
            >
              Skip stage
            </button>
          </div>
        </section>
      )}
      {imageUrl && (
        <section className="preview">
          <div className="section-title">
            <div>
              <h2>Final screenshot</h2>
              <p>{run.caption}</p>
            </div>
            <button
              disabled={busy || run.status !== 'READY_FOR_REVIEW' || run.previewState !== 'CURRENT'}
              onClick={() => void action('approve-final')}
            >
              Approve &amp; Send
            </button>
          </div>
          <div className="image-shell">
            <img src={imageUrl} alt={`${slotLabels[run.updateSlot]} report`} />
          </div>
        </section>
      )}
      <section className="detail-grid">
        <article className="panel">
          <h3>Members</h3>
          {(['completedMembers', 'missingMembers', 'exemptMembers', 'unknownMembers'] as const).map(
            (key) => (
              <details key={key}>
                <summary>
                  {key.replace('Members', '')} ({run[key]?.length ?? 0})
                </summary>
                <p>{run[key]?.join(', ') || 'None'}</p>
              </details>
            ),
          )}
        </article>
        <article className="panel">
          <h3>Delivery</h3>
          {detail.deliveries.length ? (
            detail.deliveries.map((delivery) => (
              <p key={delivery.id}>
                <b>{delivery.kind}</b> · {delivery.status}
                {delivery.lastError ? ` · ${delivery.lastError}` : ''}
              </p>
            ))
          ) : (
            <p>No deliveries yet.</p>
          )}
          <h3>Warnings</h3>
          {run.result?.warnings.map((warning) => (
            <p key={warning.code}>
              <b>{warning.severity}</b> · {warning.message}
            </p>
          )) ?? <p>None.</p>}
        </article>
      </section>
      <section className="panel history">
        <h3>Audit timeline</h3>
        {detail.events.map((event) => (
          <div className="timeline" key={event.id}>
            <time>{formatDate(event.createdAt)}</time>
            <div>
              <b>{event.eventType}</b>
              <p>{event.message}</p>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function MembersView({
  members,
  search,
  setSearch,
  sync,
  save,
}: {
  members: Member[];
  search: string;
  setSearch: (value: string) => void;
  sync: () => Promise<void>;
  save: (id: string, patch: Partial<Member>) => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Caller mapping</h2>
          <p>Sheet names remain source-of-truth. Renames require administrator review.</p>
        </div>
        <button onClick={() => void sync()}>Sync from Sheet</button>
      </div>
      <input
        placeholder="Search callers"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />{' '}
      <div className="member-list">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} save={save} />
        ))}
      </div>
    </section>
  );
}

function MemberRow({
  member,
  save,
}: {
  member: Member;
  save: (id: string, patch: Partial<Member>) => Promise<void>;
}) {
  const [username, setUsername] = useState(member.telegramUsername ?? '');
  const [userId, setUserId] = useState(member.telegramUserId ?? '');
  const [notes, setNotes] = useState(member.notes ?? '');
  const [enabled, setEnabled] = useState(member.enabled);
  return (
    <article className="member-row">
      <div>
        <b>{member.sheetCallerName}</b>
        <span className={`badge ${member.mappingStatus.toLowerCase()}`}>
          {member.mappingStatus}
        </span>
      </div>
      <input
        placeholder="Telegram username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <input
        placeholder="Telegram user ID"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
      />
      <input placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />{' '}
        Enabled
      </label>
      <button
        onClick={() =>
          void save(member.id, {
            telegramUsername: username || undefined,
            telegramUserId: userId || undefined,
            notes,
            enabled,
          })
        }
      >
        Save
      </button>
    </article>
  );
}

function TelegramView({
  health,
  bot,
  form,
  setForm,
  destinations,
  dialogs,
  destinationForm,
  setDestinationForm,
  action,
  discover,
  saveDestination,
}: {
  health?: Record<string, unknown>;
  bot?: Record<string, unknown>;
  form: { phone: string; code: string; password: string };
  setForm: React.Dispatch<React.SetStateAction<{ phone: string; code: string; password: string }>>;
  destinations: Destination[];
  dialogs: Array<{ chatId: string; title: string; type: string; isForum: boolean }>;
  destinationForm: { name: string; chatId: string; topicId: string };
  setDestinationForm: React.Dispatch<
    React.SetStateAction<{ name: string; chatId: string; topicId: string }>
  >;
  action: (path: string, body: unknown) => Promise<void>;
  discover: () => Promise<void>;
  saveDestination: () => Promise<void>;
}) {
  return (
    <div className="detail-grid">
      <section className="panel">
        <h2>Team-leader account</h2>
        <p>
          Status: <b>{textValue(health?.state, 'Unknown')}</b>
        </p>
        <p>{textValue(health?.message)}</p>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>
        <button onClick={() => void action('account/send-code', { phone: form.phone })}>
          Send login code
        </button>
        <label>
          Code
          <input
            value={form.code}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </label>
        <button onClick={() => void action('account/verify-code', { code: form.code })}>
          Verify code
        </button>
        <label>
          2FA password (never stored)
          <input
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
          />
        </label>
        <button onClick={() => void action('account/verify-password', { password: form.password })}>
          Verify password
        </button>
        <div className="actions">
          <button className="secondary" onClick={() => void discover()}>
            Discover groups
          </button>
          <button className="danger" onClick={() => void action('account/logout', {})}>
            Disconnect
          </button>
        </div>
        <h3>Administrator bot</h3>
        <pre>{JSON.stringify(bot, null, 2)}</pre>
      </section>
      <section className="panel">
        <h2>Destinations</h2>
        {destinations.map((destination) => (
          <p key={destination.id}>
            <b>{destination.name}</b> · {destination.chatId}
            {destination.topicId ? ` / topic ${destination.topicId}` : ''}
            <br />
            <small>
              Reminders {destination.sendReminders ? 'on' : 'off'} · Reports{' '}
              {destination.sendFinalReports ? 'on' : 'off'}
            </small>
          </p>
        ))}
        <label>
          Discovered dialog
          <select
            value={destinationForm.chatId}
            onChange={(event) => {
              const dialog = dialogs.find((item) => item.chatId === event.target.value);
              setDestinationForm((current) => ({
                ...current,
                chatId: event.target.value,
                name: dialog?.title ?? current.name,
              }));
            }}
          >
            <option value="">Choose or enter manually</option>
            {dialogs.map((dialog) => (
              <option key={dialog.chatId} value={dialog.chatId}>
                {dialog.title} · {dialog.type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            value={destinationForm.name}
            onChange={(event) =>
              setDestinationForm((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label>
          Chat ID
          <input
            value={destinationForm.chatId}
            onChange={(event) =>
              setDestinationForm((current) => ({ ...current, chatId: event.target.value }))
            }
          />
        </label>
        <label>
          Topic ID (optional)
          <input
            value={destinationForm.topicId}
            onChange={(event) =>
              setDestinationForm((current) => ({ ...current, topicId: event.target.value }))
            }
          />
        </label>
        <button onClick={() => void saveDestination()}>Save destination</button>
      </section>
    </div>
  );
}

function SchedulesView({
  schedules,
  save,
}: {
  schedules: Schedule[];
  save: (schedule: Schedule) => Promise<void>;
}) {
  return (
    <section className="panel">
      <h2>Daily schedules</h2>
      <p>Scheduled preparation uses the same supervised workflow. Sends still require approval.</p>
      {schedules.map((schedule) => (
        <ScheduleRow key={schedule.updateSlot} schedule={schedule} save={save} />
      ))}
    </section>
  );
}
function ScheduleRow({
  schedule,
  save,
}: {
  schedule: Schedule;
  save: (schedule: Schedule) => Promise<void>;
}) {
  const [draft, setDraft] = useState(schedule);
  useEffect(() => setDraft(schedule), [schedule]);
  return (
    <article className="schedule-row">
      <b>{slotLabels[schedule.updateSlot]}</b>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />{' '}
        Enabled
      </label>
      <input
        type="time"
        value={draft.localTime}
        onChange={(event) => setDraft({ ...draft, localTime: event.target.value })}
      />
      <input
        value={draft.timezone}
        onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
      />
      <span>Last: {draft.lastRunDate ?? 'never'}</span>
      <button onClick={() => void save(draft)}>Save</button>
    </article>
  );
}

function TemplatesView({
  templates,
  setTemplates,
  save,
}: {
  templates: { initialReminder: string; escalationReminder: string; finalCaption: string };
  setTemplates: React.Dispatch<React.SetStateAction<typeof templates>>;
  save: () => Promise<void>;
}) {
  return (
    <section className="panel">
      <h2>Message templates</h2>
      <p>
        Allowed: {'{mentions} {update_number} {update_name} {missing_count} {team_name} {date}'}
      </p>
      <label>
        Initial reminder
        <textarea
          value={templates.initialReminder}
          onChange={(event) => setTemplates({ ...templates, initialReminder: event.target.value })}
        />
      </label>
      <label>
        Escalation reminder
        <textarea
          value={templates.escalationReminder}
          onChange={(event) =>
            setTemplates({ ...templates, escalationReminder: event.target.value })
          }
        />
      </label>
      <label>
        Final caption
        <textarea
          value={templates.finalCaption}
          onChange={(event) => setTemplates({ ...templates, finalCaption: event.target.value })}
        />
      </label>
      <button onClick={() => void save()}>Save templates</button>
    </section>
  );
}
function HistoryView({ runs, open }: { runs: Run[]; open: (id: string) => void }) {
  return (
    <section className="panel">
      <h2>Run history</h2>
      <RunTable runs={runs} open={open} />
    </section>
  );
}
function RunTable({ runs, open }: { runs: Run[]; open: (id: string) => void }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Slot</th>
            <th>Status</th>
            <th>Trigger</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} onClick={() => open(run.id)}>
              <td>{run.reportDate}</td>
              <td>{slotLabels[run.updateSlot]}</td>
              <td>{run.status}</td>
              <td>{run.triggerSource}</td>
              <td>{run.missingMembers?.length ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—';
}
