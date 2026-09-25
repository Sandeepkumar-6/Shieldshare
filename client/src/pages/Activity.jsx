import { useState } from 'react';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { SkeletonRows } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import { ActivityList } from '../features/activity/ActivityList.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { accountApi } from '../services/account.service.js';
import { folderApi } from '../services/folder.service.js';
import { folderLookup } from '../utils/folders.js';
import { pluralize } from '../utils/format.js';

const PAGE_SIZE = 25;

export default function Activity() {
  const [page, setPage] = useState(1);
  const activity = useAsync(() => accountApi.activity({ page, limit: PAGE_SIZE }), [page]);
  const folders = useAsync(() => folderApi.list(), []);
  const folderName = folderLookup(folders);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything recorded on your account: sign-ins, uploads, new versions, renames, moves, downloads, deletions and restores."
      />
      <Panel
        title="Account activity"
        description={activity.status === 'success' ? `${pluralize(activity.data.meta.total, 'event')}, newest first` : undefined}
        actions={activity.status === 'success' && (
          <span className="text-meta text-fg-muted">Times in your local time zone</span>
        )}
      >
        {activity.status === 'loading' && <SkeletonRows rows={8} columns={4} label="Loading activity" />}
        {activity.status === 'error' && (
          <ErrorState title="Unable to load your activity" error={activity.error} onRetry={activity.reload} />
        )}
        {activity.status === 'success' && (activity.data.data.length === 0 ? (
          <EmptyState icon="activity" title="No activity yet" description="Sign-ins and file operations are recorded here as they happen." />
        ) : (
          <>
            <ActivityList items={activity.data.data} folderName={folderName} />
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={activity.data.meta.total}
              busy={activity.refreshing}
              onPageChange={setPage}
            />
          </>
        ))}
      </Panel>
    </>
  );
}
