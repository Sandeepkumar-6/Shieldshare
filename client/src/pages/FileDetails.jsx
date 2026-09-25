import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FileStatusBadge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { HashText } from '../components/ui/HashText.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { DetailList, PageHeader, Panel } from '../components/ui/Layout.jsx';
import { Menu } from '../components/ui/Menu.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ProgressBar } from '../components/ui/ProgressBar.jsx';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState, Notice } from '../components/ui/States.jsx';
import { TabPanel, Tabs } from '../components/ui/Tabs.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { ActivityList } from '../features/activity/ActivityList.jsx';
import { IntegrityPanel, VerificationStatus } from '../features/files/IntegrityPanel.jsx';
import { useFileActions } from '../features/files/useFileActions.jsx';
import { VersionTimeline } from '../features/files/VersionTimeline.jsx';
import { SharingPanel } from '../features/shares/SharingPanel.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAccountNoticeRefresh } from '../state/SocketContext.jsx';
import { useWriteAccess } from '../hooks/useWriteAccess.js';
import { fileApi } from '../services/file.service.js';
import { folderApi } from '../services/folder.service.js';
import { folderLookup } from '../utils/folders.js';
import { formatBytes, formatDateTime, formatRelative, pluralize, shortHash } from '../utils/format.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'versions', label: 'Versions' },
  { id: 'sharing', label: 'Sharing' },
  { id: 'activity', label: 'Activity' },
];
const UNDER_REVIEW = 'This file is under review.';

function OverviewTab({ file, folderName, activityKey, onOpenIntegrity }) {
  const recent = useAsync(() => fileApi.activity(file.id, { limit: 5 }), [file.id, activityKey]);
  const folder = folderName(file.folderId);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Panel title="Details" className="lg:col-span-3">
        <DetailList
          items={[
            { label: 'Name', value: file.name },
            {
              label: 'Folder',
              value: folder
                ? <Link to={`/app/files?folder=${file.folderId}`} className="text-fg hover:text-accent">{folder}</Link>
                : '—',
            },
            { label: 'Type', value: <span className="font-mono text-tech">{file.mimeType ?? 'unknown'}</span> },
            { label: 'Size', value: <span>{formatBytes(file.size)} <span className="text-fg-muted tabular">({file.size.toLocaleString()} bytes)</span></span> },
            { label: 'Current version', value: <span className="font-mono text-tech">v{file.currentVersion}</span> },
            { label: 'Created', value: formatDateTime(file.createdAt) },
            { label: 'Last modified', value: formatDateTime(file.updatedAt) },
            { label: 'Status', value: <FileStatusBadge status={file.status} /> },
          ]}
        />
      </Panel>

      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <Panel title="Integrity" actions={<Button size="sm" variant="ghost" onClick={onOpenIntegrity}>Verify</Button>}>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <p className="text-meta text-fg-muted">SHA-256 · v{file.currentVersion}</p>
            <HashText hash={file.sha256} />
            <VerificationStatus file={file} />
          </div>
        </Panel>

        <Panel title="Recent activity">
          {recent.status === 'loading' && <SkeletonRows rows={3} columns={2} label="Loading activity" />}
          {recent.status === 'error' && <ErrorState compact title="Activity unavailable" error={recent.error} onRetry={recent.reload} />}
          {recent.status === 'success' && (recent.data.data.length === 0 ? (
            <EmptyState compact title="No activity yet" />
          ) : (
            <ActivityList items={recent.data.data} folderName={folderName} showFile={false} showIp={false} dense />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function ActivityTab({ fileId, activityKey, folderName }) {
  const [page, setPage] = useState(1);
  const limit = 20;
  const activity = useAsync(() => fileApi.activity(fileId, { page, limit }), [fileId, page, activityKey]);

  return (
    <Panel title="File activity" description="Uploads, new versions, renames, moves, downloads and restores of this file.">
      {activity.status === 'loading' && <SkeletonRows rows={5} label="Loading activity" />}
      {activity.status === 'error' && <ErrorState title="Unable to load activity" error={activity.error} onRetry={activity.reload} />}
      {activity.status === 'success' && (activity.data.data.length === 0 ? (
        <EmptyState compact icon="activity" title="No activity yet" />
      ) : (
        <>
          <ActivityList items={activity.data.data} folderName={folderName} showFile={false} />
          <Pagination page={page} limit={limit} total={activity.data.meta.total} busy={activity.refreshing} onPageChange={setPage} />
        </>
      ))}
    </Panel>
  );
}

function RestoreSummary({ file, target }) {
  const nextNumber = file.currentVersion + 1;
  const later = target.versionNumber + 1 === file.currentVersion
    ? `v${file.currentVersion} stays`
    : `v${target.versionNumber + 1}–v${file.currentVersion} stay`;
  return (
    <>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 rounded-control border border-line-subtle bg-bg-secondary px-3.5 py-3">
        <dt className="text-meta text-fg-muted">Current</dt>
        <dd className="min-w-0 text-body break-all text-fg">
          <span className="font-mono text-tech text-fg-secondary">v{file.currentVersion}</span> · {file.name}
        </dd>
        <dt className="text-meta text-fg-muted">Restore to</dt>
        <dd className="min-w-0 text-body break-all text-fg">
          <span className="font-mono text-tech text-accent">v{target.versionNumber}</span> · {target.nameAtVersion}
        </dd>
      </dl>
      <p className="text-body text-fg-secondary">
        ShieldShare creates v{nextNumber} from v{target.versionNumber}&apos;s stored content and verifies its SHA-256
        before completing.
        {target.nameAtVersion !== file.name && <> The file name changes back to <span className="text-fg">{target.nameAtVersion}</span>.</>}
        {' '}Nothing is deleted: {later} in the version history.
      </p>
    </>
  );
}

export default function FileDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const access = useWriteAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((entry) => entry.id === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const setTab = (next) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true });

  const file = useAsync(() => fileApi.get(id), [id]);
  const versions = useAsync(() => fileApi.versions(id), [id]);
  const folders = useAsync(() => folderApi.list(), []);
  const [activityKey, setActivityKey] = useState(0);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [replacing, setReplacing] = useState(null); // { status, progress, name, error }
  const contentInput = useRef(null);

  const refreshAll = () => {
    file.reload();
    versions.reload();
    setActivityKey((key) => key + 1);
  };
  useAccountNoticeRefresh(refreshAll);

  const folderList = folders.data ?? [];
  const folderName = folderLookup(folders);
  const actions = useFileActions({
    folders: folderList,
    onChanged: refreshAll,
    onDeleted: () => navigate('/app/files', { replace: true }),
  });

  async function uploadNewContent(selected) {
    if (!selected) return;
    setReplacing({ status: 'uploading', progress: 0, name: selected.name });
    try {
      const result = await fileApi.replaceContent(id, selected, {
        onProgress: (fraction) => setReplacing((state) => ({
          ...state,
          ...(fraction >= 1 ? { status: 'processing', progress: 1 } : { progress: fraction }),
        })),
      });
      setReplacing(null);
      toast.success(`Version ${result.version.versionNumber} created`, `SHA-256 ${shortHash(result.version.sha256)}`);
      refreshAll();
    } catch (error) {
      setReplacing({ status: 'error', name: selected.name, error });
    }
  }

  if (file.status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <span className="sr-only">Loading file</span>
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-4 h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (file.status === 'error') {
    return file.error?.status === 404 ? (
      <EmptyState
        icon="file"
        title="File not found"
        description="This file doesn't exist, has been deleted, or belongs to another account."
        action={<Button to="/app/files" icon="arrowLeft">Back to files</Button>}
      />
    ) : (
      <ErrorState title="Unable to load this file" error={file.error} onRetry={file.reload} />
    );
  }

  const current = file.data;
  const underReview = current.status === 'QUARANTINED';
  const writeReason = access.reason ?? (underReview ? UNDER_REVIEW : null);
  const writeHint = access.hint ?? (underReview ? 'File is under review' : null);
  const busyReplacing = replacing?.status === 'uploading' || replacing?.status === 'processing';

  return (
    <>
      <PageHeader
        breadcrumb={(
          <span className="flex flex-wrap items-center gap-1">
            <Link to="/app/files" className="hover:text-fg">Files</Link>
            {folderName(current.folderId) && (
              <>
                <Icon name="chevronRight" className="size-3" />
                <Link to={`/app/files?folder=${current.folderId}`} className="hover:text-fg">{folderName(current.folderId)}</Link>
              </>
            )}
          </span>
        )}
        title={current.name}
        meta={(
          <>
            <FileStatusBadge status={current.status} />
            <span className="font-mono text-tech">v{current.currentVersion}</span>
            <span>{formatBytes(current.size)}</span>
            <span>
              Modified <time dateTime={current.updatedAt} title={formatDateTime(current.updatedAt)}>{formatRelative(current.updatedAt)}</time>
            </span>
          </>
        )}
        actions={(
          <>
            <Button icon="download" disabledReason={underReview ? UNDER_REVIEW : null} onClick={() => actions.download(current)}>
              Download
            </Button>
            <Button
              icon="upload"
              loading={busyReplacing}
              disabledReason={writeReason}
              onClick={() => contentInput.current?.click()}
            >
              Upload new version
            </Button>
            <Menu
              label="More file actions"
              triggerClassName="size-9 border border-line bg-surface-elevated"
              items={[
                { label: 'Rename', icon: 'pencil', disabledReason: writeReason, disabledHint: writeHint, onSelect: () => actions.openRename(current) },
                { label: 'Move', icon: 'folderMove', disabledReason: writeReason, disabledHint: writeHint, onSelect: () => actions.openMove(current) },
                { label: 'Delete', icon: 'trash', tone: 'danger', disabledReason: writeReason, disabledHint: writeHint, onSelect: () => actions.openDelete(current) },
              ]}
            />
            <input
              ref={contentInput}
              type="file"
              className="hidden"
              onChange={(event) => {
                uploadNewContent(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </>
        )}
      />

      {/* Spec §25: "Under review", no risk scores, signals or reasons. */}
      {underReview && (
        <Notice tone="warning" title="This file is under review" className="mb-5">
          You can see its details and history. Downloading, changing, moving, deleting and sharing it are paused
          until the review is finished, and its share links are paused too.
        </Notice>
      )}

      {replacing && (
        <div className="mb-5 rounded-card border border-line-subtle bg-surface px-4 py-3">
          {replacing.status === 'error' ? (
            <div className="flex items-start justify-between gap-3">
              <Notice tone="critical" title={`New version not created from ${replacing.name}`} className="flex-1">
                {replacing.error?.message}
              </Notice>
              <Button size="icon" variant="ghost" icon="close" aria-label="Dismiss" onClick={() => setReplacing(null)} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-body text-fg">
                {replacing.status === 'uploading'
                  ? <>Uploading <span className="font-medium">{replacing.name}</span> as a new version · <span className="tabular">{Math.round(replacing.progress * 100)}%</span></>
                  : 'Sent · server is validating, hashing and creating the version'}
              </p>
              <ProgressBar label="New version upload" value={replacing.progress} indeterminate={replacing.status === 'processing'} />
            </div>
          )}
        </div>
      )}

      <Tabs
        idPrefix="file"
        label="File sections"
        tabs={TABS.map((entry) => {
          if (entry.id === 'versions' && versions.status === 'success') return { ...entry, count: versions.data.length };
          if (entry.id === 'sharing' && current.shareCount != null) return { ...entry, count: current.shareCount };
          return entry;
        })}
        value={tab}
        onChange={setTab}
      />

      <TabPanel idPrefix="file" id={tab}>
        {tab === 'overview' && (
          <OverviewTab file={current} folderName={folderName} activityKey={activityKey} onOpenIntegrity={() => setTab('integrity')} />
        )}

        {(tab === 'integrity' || tab === 'versions') && versions.status === 'loading' && (
          <div className="rounded-card border border-line-subtle bg-surface"><SkeletonRows rows={3} label="Loading versions" /></div>
        )}
        {(tab === 'integrity' || tab === 'versions') && versions.status === 'error' && (
          <Panel><ErrorState title="Unable to load versions" error={versions.error} onRetry={versions.reload} /></Panel>
        )}

        {tab === 'integrity' && versions.status === 'success' && (
          <IntegrityPanel key={current.currentVersion} file={current} versions={versions.data} onVerified={() => file.reload()} />
        )}

        {tab === 'versions' && versions.status === 'success' && (
          <Panel
            title="Version history"
            description={`${pluralize(versions.data.length, 'version')} · restoring creates a new version; nothing is overwritten`}
          >
            <div className="p-4">
              <VersionTimeline
                file={current}
                versions={versions.data}
                access={access}
                onDownload={(version) => actions.download(current, {
                  versionId: version.id,
                  versionNumber: version.versionNumber,
                  name: version.nameAtVersion,
                })}
                onRestore={setRestoreTarget}
              />
            </div>
          </Panel>
        )}

        {tab === 'sharing' && <SharingPanel file={current} access={access} onChanged={refreshAll} />}

        {tab === 'activity' && <ActivityTab fileId={current.id} activityKey={activityKey} folderName={folderName} />}
      </TabPanel>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        title={restoreTarget ? `Restore version ${restoreTarget.versionNumber}?` : 'Restore version'}
        confirmLabel="Restore version"
        onConfirm={async () => {
          const result = await fileApi.restore(current.id, restoreTarget.id);
          toast.success(
            `Restored as v${result.newVersion.versionNumber}`,
            `SHA-256 verified against v${restoreTarget.versionNumber}'s fingerprint`,
          );
          refreshAll();
        }}
      >
        {restoreTarget && <RestoreSummary file={current} target={restoreTarget} />}
      </ConfirmDialog>

      {actions.dialogs}
    </>
  );
}
