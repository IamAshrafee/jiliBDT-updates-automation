'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Slot = 'UPDATE_1' | 'UPDATE_2' | 'UPDATE_3';
type Classification = 'COMPLETE' | 'MISSING' | 'EXEMPT' | 'UNKNOWN';

interface MemberResult {
  caller: string;
  sourceRow: number;
  classification: Classification;
  reasons: string[];
}

interface RunResult {
  completion: {
    members: MemberResult[];
    counts: Record<Classification, number>;
  };
  warnings: Array<{ code: string; severity: string; message: string }>;
  structuralHealth: { healthy: boolean; headerRowIndex?: number };
  snapshotHash: string;
}

interface Run {
  id: string;
  reportDate: string;
  updateSlot: Slot;
  status: string;
  previewState: string;
  latestFetchAt?: string;
  snapshotHash?: string;
  failureReason?: string;
  screenshotArtifactPath?: string;
  result?: RunResult;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4100';
const pendingStatuses = new Set(['CREATED', 'PREPARING', 'CHECKING_MEMBERS']);

export default function PhaseOneAdmin() {
  const [token, setToken] = useState('');
  const [slot, setSlot] = useState<Slot>('UPDATE_1');
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run>();
  const [message, setMessage] = useState('Enter the local administrator token if configured.');
  const [busy, setBusy] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>();

  useEffect(() => setToken(sessionStorage.getItem('jilibdt-admin-token') ?? ''), []);
  useEffect(() => {
    sessionStorage.setItem('jilibdt-admin-token', token);
  }, [token]);

  const headers = useMemo(
    () => ({ 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) }),
    [token],
  );

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { ...headers, ...init?.headers },
      });
      const body = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
      return body;
    },
    [headers],
  );

  const loadRuns = useCallback(async () => {
    try {
      const response = await request<{ runs: Run[] }>('/api/runs');
      setRuns(response.runs);
      setMessage('Runs loaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load runs.');
    }
  }, [request]);

  const loadRun = useCallback(
    async (id: string) => {
      const response = await request<{ run: Run }>(`/api/runs/${id}`);
      setSelected(response.run);
      return response.run;
    },
    [request],
  );

  useEffect(() => void loadRuns(), [loadRuns]);

  useEffect(() => {
    if (!selected || !pendingStatuses.has(selected.status)) return;
    const timer = window.setInterval(() => void loadRun(selected.id), 1200);
    return () => window.clearInterval(timer);
  }, [loadRun, selected]);

  useEffect(() => {
    if (!selected?.screenshotArtifactPath) {
      setImageUrl(undefined);
      return;
    }
    let active = true;
    void fetch(`${API_URL}/api/runs/${selected.id}/artifact`, {
      headers: token ? { 'x-admin-token': token } : {},
    })
      .then((response) => {
        if (!response.ok) throw new Error('Screenshot could not be loaded.');
        return response.blob();
      })
      .then((blob) => {
        if (active) setImageUrl(URL.createObjectURL(blob));
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : 'Preview failed.'),
      );
    return () => {
      active = false;
    };
  }, [selected?.id, selected?.screenshotArtifactPath, token]);

  async function prepare(forceNew = false) {
    setBusy(true);
    try {
      const response = await request<{ run: Run; idempotentReuse: boolean }>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({ slot, triggerSource: 'DASHBOARD', forceNew }),
      });
      setSelected(response.run);
      setMessage(
        response.idempotentReuse ? 'Existing active run reused safely.' : 'Preparation started.',
      );
      await loadRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preparation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: 'refresh' | 'revalidate' | 'cancel') {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await request<{ stale?: boolean }>(`/api/runs/${selected.id}/${action}`, {
        method: 'POST',
        body: '{}',
      });
      setMessage(
        action === 'revalidate'
          ? response.stale
            ? 'Preview is STALE: the Sheet source changed.'
            : 'Preview is current.'
          : `${action[0]!.toUpperCase()}${action.slice(1)} requested.`,
      );
      await loadRun(selected.id);
      await loadRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${action} failed.`);
    } finally {
      setBusy(false);
    }
  }

  const counts = selected?.result?.completion.counts;
  const missing = selected?.result?.completion.members.filter(
    (member) => member.classification === 'MISSING',
  );

  return (
    <main>
      <header>
        <p className="eyebrow">PHASE 1 · ADMINISTRATOR REVIEW</p>
        <h1>JiliBDT Update Preparation</h1>
        <p>Read, classify, render, and review. This phase never sends team Telegram messages.</p>
      </header>

      <section className="panel controls">
        <label>
          Local admin token
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Update slot
          <select value={slot} onChange={(event) => setSlot(event.target.value as Slot)}>
            <option value="UPDATE_1">Update 1 · A:H</option>
            <option value="UPDATE_2">Update 2 · J:Q</option>
            <option value="UPDATE_3">Update 3 · S:Z</option>
          </select>
        </label>
        <button disabled={busy} onClick={() => void prepare(false)}>
          Prepare
        </button>
        <p className="message">{message}</p>
      </section>

      {selected && (
        <>
          <section className="panel run-heading">
            <div>
              <p className="eyebrow">
                {selected.reportDate} · {selected.updateSlot.replace('_', ' ')}
              </p>
              <h2>{selected.status}</h2>
              <p>
                Preview: <strong>{selected.previewState}</strong>
              </p>
            </div>
            <div className="actions">
              <button
                disabled={busy || selected.status === 'CANCELLED'}
                onClick={() => void runAction('refresh')}
              >
                Refresh
              </button>
              <button
                disabled={busy || !selected.snapshotHash}
                onClick={() => void runAction('revalidate')}
              >
                Revalidate
              </button>
              <button
                className="danger"
                disabled={busy || selected.status === 'CANCELLED'}
                onClick={() => void runAction('cancel')}
              >
                Cancel
              </button>
            </div>
          </section>

          {counts && (
            <section className="metrics">
              {(['COMPLETE', 'MISSING', 'EXEMPT', 'UNKNOWN'] as const).map((classification) => (
                <article key={classification} className={`metric ${classification.toLowerCase()}`}>
                  <span>{classification}</span>
                  <strong>{counts[classification]}</strong>
                </article>
              ))}
            </section>
          )}

          {selected.failureReason && (
            <section className="panel error">
              <h3>Failure</h3>
              <p>{selected.failureReason}</p>
            </section>
          )}

          {selected.result && (
            <section className="detail-grid">
              <article className="panel">
                <h3>Sheet health</h3>
                <p>
                  {selected.result.structuralHealth.healthy
                    ? 'Expected headers found.'
                    : 'Blocking structure problem.'}
                </p>
                <p className="hash">Snapshot {selected.result.snapshotHash}</p>
                <h3>Warnings</h3>
                {selected.result.warnings.length === 0 ? (
                  <p>None.</p>
                ) : (
                  <ul>
                    {selected.result.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${index}`}>
                        <strong>{warning.severity}</strong> · {warning.message}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article className="panel">
                <h3>Missing callers</h3>
                {!missing?.length ? (
                  <p>None.</p>
                ) : (
                  <ul>
                    {missing.map((member) => (
                      <li key={`${member.caller}-${member.sourceRow}`}>
                        <strong>{member.caller}</strong> · {member.reasons.join('; ')}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </section>
          )}

          {imageUrl && (
            <section className="preview">
              <h2>Generated preview</h2>
              <div className="image-shell">
                <img src={imageUrl} alt={`${selected.updateSlot} generated Sheet report`} />
              </div>
            </section>
          )}
        </>
      )}

      <section className="panel history">
        <div className="history-title">
          <h2>Recent runs</h2>
          <button onClick={() => void loadRuns()}>Reload</button>
        </div>
        {runs.length === 0 ? (
          <p>No runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Slot</th>
                <th>Status</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} onClick={() => void loadRun(run.id)}>
                  <td>{run.reportDate}</td>
                  <td>{run.updateSlot}</td>
                  <td>{run.status}</td>
                  <td>{run.previewState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
