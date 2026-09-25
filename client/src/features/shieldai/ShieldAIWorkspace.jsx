import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { IncidentTimeline } from '../../components/security/IncidentTimeline.jsx';
import { RiskBreakdown } from '../../components/security/RiskBreakdown.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Textarea } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Panel } from '../../components/ui/Layout.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { shieldAiApi } from '../../services/shieldai.service.js';
import { useAuth } from '../../state/AuthContext.jsx';
import { formatDateTime } from '../../utils/format.js';

const ADMIN_SUGGESTIONS = ['Explain the latest incident', 'Show critical threats', "Summarize today's security activity", 'What should I investigate?'];
const USER_SUGGESTIONS = ['What is my account status?', 'Show my recently changed files', 'Which share links expire soon?', 'Explain my recent activity'];

function citationLink(citation, isAdmin) {
  if (!isAdmin && citation.kind === 'file') return `/app/files/${citation.id}`;
  if (citation.kind === 'incident') return `/admin/incidents/${citation.id}`;
  if (citation.kind === 'file') return `/admin/files?q=${citation.id}`;
  if (citation.kind === 'user') return `/admin/users?id=${citation.id}`;
  return null;
}

function EvidenceBlock({ block, toolMessages }) {
  const source = [...toolMessages].reverse().find((message) => message.toolName === block.source)?.toolResult;
  if (!source) return null;
  if (block.type === 'riskBreakdown') {
    const evaluation = source.peak ?? source.latest;
    return evaluation ? <div className="rounded-control border border-line-subtle p-3"><RiskBreakdown evaluation={evaluation} /></div> : null;
  }
  if (block.type === 'timeline') {
    return source.timeline ? <div className="rounded-control border border-line-subtle p-3"><IncidentTimeline entries={source.timeline} /></div> : null;
  }
  const files = source.affectedFiles ?? source.files ?? [];
  return files.length ? (
    <div className="overflow-x-auto rounded-control border border-line-subtle">
      <table className="w-full text-body"><thead><tr className="border-b border-line-subtle text-left text-meta text-fg-muted"><th className="px-3 py-2">Affected file</th><th className="px-3 py-2">Status</th></tr></thead>
        <tbody className="divide-y divide-line-subtle">{files.map((file) => <tr key={file.id}><td className="px-3 py-2">{file.name}</td><td className="px-3 py-2">{file.status ?? 'Unknown'}</td></tr>)}</tbody>
      </table>
    </div>
  ) : null;
}

function ActionConfirmation({ action, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const proposed = action.status === 'PROPOSED';
  const expired = proposed && new Date(action.expiresAt) <= new Date();
  const act = async (kind) => {
    setBusy(kind); setError(null);
    try { await (kind === 'confirm' ? shieldAiApi.confirm(action.id) : shieldAiApi.cancel(action.id)); onChanged(); }
    catch (failure) { setError(failure); }
    finally { setBusy(null); }
  };
  return (
    <section className="mt-3 rounded-card border border-warning/40 bg-warning/5 p-4" aria-label="Action confirmation">
      <div className="flex items-center gap-2"><Icon name="alert" className="size-4 text-warning" /><h3 className="font-semibold text-fg">{action.summary.title}</h3><Badge tone={action.status === 'EXECUTED' ? 'success' : 'warning'}>{expired ? 'EXPIRED' : action.status}</Badge></div>
      <p className="mt-2 text-body text-fg"><span className="text-fg-muted">Target:</span> {action.summary.target}</p>
      {action.summary.from && <p className="text-body text-fg-secondary">{action.summary.from} → {action.summary.to}</p>}
      <p className="mt-1 text-body text-fg-secondary">{action.summary.consequence}</p>
      {proposed && !expired && <p className="mt-2 text-meta text-fg-muted">Expires {formatDateTime(action.expiresAt)}</p>}
      {error && <p className="mt-2 text-meta text-critical">{error.message}</p>}
      {proposed && !expired && <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => act('cancel')} loading={busy === 'cancel'}>Cancel</Button><Button size="sm" variant="primary" onClick={() => act('confirm')} loading={busy === 'confirm'}>Confirm</Button></div>}
      {action.status === 'EXECUTED' && action.result && <p className="mt-2 text-meta text-fg-secondary">Completed successfully.</p>}
    </section>
  );
}

function AssistantMessage({ message, toolMessages, pendingById, onChanged, isAdmin }) {
  const action = message.pendingActionId ? pendingById.get(String(message.pendingActionId)) : null;
  return (
    <article className="rounded-card border border-line-subtle bg-surface px-4 py-3">
      <p className="mb-2 text-meta font-medium text-fg-muted">{isAdmin ? 'Shield AI' : 'ShieldShare assistant'}</p>
      {message.toolRuns?.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{message.toolRuns.map((run, index) => <span key={`${run.name}-${index}`} className="inline-flex items-center gap-1 text-meta text-fg-muted"><Icon name="check" className="size-3 text-success" />{run.label}</span>)}</div>}
      <p className="whitespace-pre-wrap text-body text-fg">{message.content}</p>
      {message.blocks?.map((block, index) => <div className="mt-3" key={`${block.type}-${index}`}><EvidenceBlock block={block} toolMessages={toolMessages} /></div>)}
      {message.citations?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{message.citations.map((citation) => { const to = citationLink(citation, isAdmin); return to ? <Link key={`${citation.kind}-${citation.id}`} to={to} className="font-mono text-meta text-accent hover:underline">{citation.label}</Link> : <span key={`${citation.kind}-${citation.id}`} className="font-mono text-meta text-fg-muted">{citation.label}</span>; })}</div>}
      {action && <ActionConfirmation action={action} onChanged={onChanged} />}
    </article>
  );
}

export function ShieldAIWorkspace({ context, compact = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const suggestions = isAdmin ? ADMIN_SUGGESTIONS : USER_SUGGESTIONS;
  const availability = useAsync(() => shieldAiApi.status(), []);
  const conversations = useAsync(() => compact ? Promise.resolve([]) : shieldAiApi.conversations(), [compact]);
  const [selectedId, setSelectedId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!compact && !selectedId && conversations.data?.length) setSelectedId(conversations.data[0].id);
  }, [compact, conversations.data, selectedId]);
  const loadConversation = async (id = selectedId) => { if (id) setConversation(await shieldAiApi.conversation(id)); };
  useEffect(() => { if (selectedId) loadConversation(selectedId).catch(setError); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingById = useMemo(() => new Map((conversation?.pendingActions ?? []).map((action) => [action.id, action])), [conversation]);
  const toolMessages = (conversation?.messages ?? []).filter((message) => message.role === 'tool');
  const visibleMessages = (conversation?.messages ?? []).filter((message) => message.role !== 'tool');

  const send = async (text = input) => {
    const content = text.trim();
    if (!content || sending || !availability.data?.available) return;
    setSending(true); setError(null);
    try {
      let id = selectedId;
      if (!id) {
        const created = await shieldAiApi.createConversation(context);
        id = created.id; setSelectedId(id);
      }
      await shieldAiApi.send(id, content, context);
      setInput('');
      setConversation(await shieldAiApi.conversation(id));
      conversations.reload();
    } catch (failure) { setError(failure); }
    finally { setSending(false); }
  };

  if (availability.status === 'loading') return <SkeletonRows rows={3} columns={2} label={`Checking ${isAdmin ? 'Shield AI' : 'the assistant'}`} />;
  if (availability.status === 'error') return <ErrorState compact title={`${isAdmin ? 'Shield AI' : 'Assistant'} status unavailable`} error={availability.error} onRetry={availability.reload} />;
  if (!availability.data.available) return <EmptyState compact icon="message" title={`${isAdmin ? 'Shield AI' : 'The assistant'} is unavailable`} description={availability.data.reason || (isAdmin ? 'Configure the server-side provider to enable investigations.' : 'Try again later. Your files and sharing features still work normally.')} />;

  const chat = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={`${compact ? 'max-h-[28rem]' : 'min-h-[24rem] max-h-[60vh]'} flex flex-col gap-3 overflow-y-auto pr-1`} aria-live="polite">
        {visibleMessages.length === 0 ? <EmptyState compact icon="message" title={isAdmin ? 'Start an investigation' : 'Ask about your workspace'} description={isAdmin ? 'Shield AI uses controlled read tools. It never reads file contents or performs an action without confirmation.' : 'The assistant can look up your account, files, shares, and recent activity. It never reads file contents or makes changes.'} /> : visibleMessages.map((message) => message.role === 'user'
          ? <article key={message._id ?? message.id} className="ml-auto max-w-[85%] rounded-card bg-surface-elevated px-4 py-3 text-body text-fg">{message.content}</article>
          : <AssistantMessage key={message._id ?? message.id} message={message} toolMessages={toolMessages} pendingById={pendingById} onChanged={() => loadConversation()} isAdmin={isAdmin} />)}
        {sending && <p className="flex items-center gap-2 text-body text-fg-muted"><Icon name="search" className="size-4" />{isAdmin ? 'Investigating stored ShieldShare evidence…' : 'Checking your ShieldShare workspace…'}</p>}
      </div>
      {error && <p className="text-meta text-critical">{error.message}</p>}
      {visibleMessages.length === 0 && <div className="flex flex-wrap gap-2">{suggestions.slice(0, compact ? 2 : 4).map((prompt) => <Button key={prompt} size="sm" onClick={() => send(prompt)}>{prompt}</Button>)}</div>}
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <Textarea label={isAdmin ? 'Ask Shield AI' : 'Ask the assistant'} rows={compact ? 2 : 3} value={input} maxLength={4000} placeholder={isAdmin ? 'Ask about an incident, risk score, affected files, or recovery…' : 'Ask about your files, shares, activity, or account status…'} onChange={(event) => setInput(event.target.value)} disabled={sending} className="flex-1" />
        <Button type="submit" variant="primary" loading={sending} disabled={!input.trim()}>Send</Button>
      </form>
    </div>
  );

  if (compact) return chat;
  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Panel title="Conversations" actions={<Button size="sm" onClick={() => { setSelectedId(null); setConversation(null); }}>New</Button>}>
        <div className="divide-y divide-line-subtle">{conversations.data?.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full px-3 py-3 text-left text-body hover:bg-surface-hover ${selectedId === item.id ? 'bg-surface-elevated text-fg' : 'text-fg-secondary'}`}><span className="block truncate">{item.title}</span><span className="text-meta text-fg-muted">{item.messageCount} messages</span></button>)}</div>
      </Panel>
      <Panel title={isAdmin ? 'Security investigation' : 'Workspace assistant'} description={isAdmin ? `Provider: ${availability.data.provider} · Model: ${availability.data.model}` : 'Answers use only your authorized ShieldShare records.'}><div className="p-4">{chat}</div></Panel>
    </div>
  );
}
