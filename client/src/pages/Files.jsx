import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { SkeletonRows } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import { ALL_FILES, FolderNav } from '../features/files/FolderNav.jsx';
import { FileTable } from '../features/files/FileTable.jsx';
import { UploadPanel } from '../features/files/UploadPanel.jsx';
import { useFileActions } from '../features/files/useFileActions.jsx';
import { useUploadQueue } from '../features/files/useUploadQueue.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAccountNoticeRefresh } from '../state/SocketContext.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useWriteAccess } from '../hooks/useWriteAccess.js';
import { fileApi } from '../services/file.service.js';
import { folderApi } from '../services/folder.service.js';
import { pluralize } from '../utils/format.js';

const PAGE_SIZE = 20;

export default function Files() {
  const access = useWriteAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get('folder') || ALL_FILES;
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const [sort, setSort] = useState('-updatedAt');

  // The page resets whenever the view changes, without a second request.
  const viewKey = `${selected}|${q}|${sort}`;
  const [paging, setPaging] = useState({ key: viewKey, page: 1 });
  const page = paging.key === viewKey ? paging.page : 1;

  const folders = useAsync(() => folderApi.list(), []);
  const files = useAsync(
    () => fileApi.list({
      folderId: selected === ALL_FILES ? undefined : selected,
      q: q || undefined,
      sort,
      page,
      limit: PAGE_SIZE,
    }),
    [selected, q, sort, page],
  );
  useAccountNoticeRefresh(files.reload);

  const folderList = folders.data ?? [];
  const folderName = (id) => folderList.find((folder) => folder.id === id)?.name;
  const root = folderList.find((folder) => folder.isRoot);
  const uploadFolderId = selected === ALL_FILES ? root?.id : selected;
  const uploadFolderLabel = selected === ALL_FILES ? (root?.name ?? 'Home') : folderName(selected);

  const selectFolder = (id) => {
    setSearchParams(id === ALL_FILES ? {} : { folder: id });
  };

  const queue = useUploadQueue({ onUploaded: () => files.reload() });
  const actions = useFileActions({
    folders: folderList,
    onChanged: () => files.reload(),
    onDeleted: () => files.reload(),
  });

  const total = files.data?.meta?.total ?? 0;
  const list = files.data?.data ?? [];

  let body;
  if (files.status === 'loading') {
    body = <SkeletonRows rows={6} columns={5} label="Loading files" />;
  } else if (files.status === 'error' && [404, 422].includes(files.error?.status) && selected !== ALL_FILES) {
    // A folder in the URL that was deleted, or never belonged to this account.
    body = (
      <EmptyState
        compact
        icon="folder"
        title="This folder doesn't exist"
        description="It may have been deleted."
        action={<Button onClick={() => selectFolder(ALL_FILES)}>Show all files</Button>}
      />
    );
  } else if (files.status === 'error') {
    body = <ErrorState title="Unable to load your files" error={files.error} onRetry={files.reload} />;
  } else if (list.length === 0) {
    body = q ? (
      <EmptyState compact icon="search" title={`No files match "${q}"`} description="Search looks at file names in the current folder view." />
    ) : selected !== ALL_FILES ? (
      <EmptyState compact icon="folder" title="This folder is empty" description="Upload files here, or move files into this folder from another one." />
    ) : (
      <EmptyState
        icon="upload"
        title="No files yet"
        description="Upload your first file above. ShieldShare records its SHA-256 fingerprint and keeps every version you create."
      />
    );
  } else {
    body = (
      <>
        <FileTable
          files={list}
          folderName={folderName}
          showFolder={selected === ALL_FILES}
          sort={sort}
          onSortChange={setSort}
          actions={actions}
          access={access}
        />
        <Pagination
          page={page}
          limit={PAGE_SIZE}
          total={total}
          busy={files.refreshing}
          onPageChange={(next) => setPaging({ key: viewKey, page: next })}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Files" description="Upload and organize files. Every change creates a new version with its own SHA-256 fingerprint." />

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <FolderNav
          folders={folders}
          selected={selected}
          onSelect={selectFolder}
          access={access}
          onChanged={folders.reload}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <UploadPanel
            queue={queue}
            folderId={uploadFolderId}
            folderLabel={uploadFolderLabel ?? 'this folder'}
            access={access}
          />

          <Panel
            title={selected === ALL_FILES ? 'All files' : (folderName(selected) ?? 'Folder')}
            description={files.status === 'success' ? pluralize(total, 'file') : undefined}
            actions={(
              <div className="relative w-full sm:w-64">
                <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
                <Input
                  type="search"
                  aria-label="Search files by name"
                  placeholder="Search by name"
                  value={query}
                  maxLength={100}
                  onChange={(event) => setQuery(event.target.value)}
                  inputClassName="pl-8"
                />
              </div>
            )}
          >
            {body}
          </Panel>
        </div>
      </div>

      {actions.dialogs}
    </>
  );
}
