import { useState } from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Select } from '../../components/ui/Field.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { adminApi } from '../../services/admin.service.js';
import { formatDate, formatDateTime, formatTime, pluralize } from '../../utils/format.js';

const PAGE_SIZE = 25;

export const AUDIT_ACTION_LABELS = {
  FREEZE_USER: 'Freeze account',
  UNFREEZE_USER: 'Unfreeze account',
  QUARANTINE_FILE: 'Quarantine file',
  RELEASE_QUARANTINE: 'Release quarantine',
  FORENSIC_DOWNLOAD: 'Forensic download',
  REQUEST_FILE_ACCESS: 'Requested file access',
  INVESTIGATE_INCIDENT: 'Start investigation',
  RESOLVE_INCIDENT: 'Resolve incident',
  RESTORE_VERSION: 'Restore file',
  RESTORE_ALL: 'Restore all files',
  ACK_ALERT: 'Acknowledge alert',
  CONFIG_UPDATE: 'Change detection config',
};

const TARGET_KIND = { User: 'Account', File: 'File', FileAccessRequest: 'File access request', QuarantineItem: 'Quarantine', SecurityIncident: 'Incident', Alert: 'Alert', DetectionConfig: 'Detection config' };

const RESULTS = [
  { value: '', label: 'All' },
  { value: 'SUCCESS', label: 'Succeeded' },
  { value: 'FAILURE', label: 'Failed' },
];

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Before → after, one line per field that the action recorded.
function Changes({ before, after }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (keys.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {keys.map((key) => (
        <li key={key} className="font-mono text-meta break-all text-fg-muted">
          {key}: {before && key in before ? `${formatValue(before[key])} → ` : ''}{formatValue(after?.[key])}
        </li>
      ))}
    </ul>
  );
}

export default function AdminAudit() {
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const viewKey = `${action}|${result}`;
  const [paging, setPaging] = useState({ key: viewKey, page: 1 });
  const page = paging.key === viewKey ? paging.page : 1;
  const audit = useAsync(
    () => adminApi.audit({ action: action || undefined, result: result || undefined, page, limit: PAGE_SIZE }),
    [action, result, page],
  );
  const knownActions = audit.data?.meta?.actions ?? [];

  let body;
  if (audit.status === 'loading') body = <SkeletonRows rows={6} columns={5} label="Loading audit log" />;
  else if (audit.status === 'error') body = <ErrorState title="Unable to load the audit log" error={audit.error} onRetry={audit.reload} />;
  else if (audit.data.data.length === 0) {
    body = action || result
      ? <EmptyState compact icon="audit" title="No matching entries" description="Change the filters to see other entries." />
      : <EmptyState icon="audit" title="No administrator actions yet" description="Freezes, quarantines, releases and forensic downloads are recorded here, including attempts that failed." />;
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-body">
            <thead className="border-b border-line-subtle">
              <tr className="text-left text-meta text-fg-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">When</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Administrator</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Action</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Target</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Result</th>
                <th scope="col" className="w-full px-4 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle align-top">
              {audit.data.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)} className="flex flex-col">
                      <span className="font-mono text-tech text-fg-secondary tabular">{formatTime(entry.createdAt)}</span>
                      <span className="text-meta text-fg-muted">{formatDate(entry.createdAt)}</span>
                    </time>
                  </td>
                  <td className="px-4 py-3">
                    <p className="whitespace-nowrap text-fg">{entry.admin?.name ?? 'Unknown'}</p>
                    <p className="font-mono text-meta text-fg-muted">{entry.ip}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-fg">{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</td>
                  <td className="px-4 py-3">
                    {entry.target ? (
                      <>
                        <p className="text-meta text-fg-muted">{TARGET_KIND[entry.target.kind] ?? entry.target.kind}</p>
                        <p className="max-w-56 truncate text-fg-secondary" title={entry.target.label ?? entry.target.id ?? undefined}>
                          {entry.target.label ?? entry.target.id ?? 'Not identified'}
                        </p>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {entry.result === 'SUCCESS'
                      ? <Badge tone="success" dot>Succeeded</Badge>
                      : <Badge tone="critical" dot>Failed</Badge>}
                  </td>
                  <td className="max-w-0 px-4 py-3">
                    {entry.note && <p className="break-words text-fg">“{entry.note}”</p>}
                    {entry.error && <p className="font-mono text-meta break-words text-critical">{entry.error}</p>}
                    <Changes before={entry.before} after={entry.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={PAGE_SIZE} total={audit.data.meta.total} busy={audit.refreshing} onPageChange={(next) => setPaging({ key: viewKey, page: next })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every administrator security action, including attempts that failed. Entries cannot be edited or deleted."
      />
      <Panel
        title="Entries"
        description={audit.status === 'success' ? `${pluralize(audit.data.meta.total, 'entry', 'entries')}, newest first` : undefined}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs label="Filter by result" options={RESULTS} value={result} onChange={setResult} />
            <Select aria-label="Filter by action" value={action} onChange={(event) => setAction(event.target.value)} className="w-48">
              <option value="">All actions</option>
              {knownActions.map((name) => <option key={name} value={name}>{AUDIT_ACTION_LABELS[name] ?? name}</option>)}
            </Select>
          </div>
        )}
      >
        {body}
      </Panel>
    </>
  );
}
