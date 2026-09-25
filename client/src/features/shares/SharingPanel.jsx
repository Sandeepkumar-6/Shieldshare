import { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Panel } from '../../components/ui/Layout.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { shareApi } from '../../services/share.service.js';
import { CreateShareDialog } from './CreateShareDialog.jsx';
import { ShareLinkTable } from './ShareLinkTable.jsx';

// File Details → Sharing tab.
export function SharingPanel({ file, access, onChanged }) {
  const [creating, setCreating] = useState(false);
  const links = useAsync(() => shareApi.list({ fileId: file.id, limit: 100 }), [file.id]);
  const underReview = file.status === 'QUARANTINED';
  const createReason = access.reason ?? (underReview ? 'This file is under review, so it can\'t be shared right now.' : null);

  const refresh = () => {
    links.reload();
    onChanged?.();
  };

  const createButton = (
    <Button variant="primary" icon="link" disabledReason={createReason} onClick={() => setCreating(true)}>
      Create link
    </Button>
  );

  return (
    <>
      <Panel
        title="Share links"
        description="Anyone holding a link (and its password, if set) can use it until it expires or you revoke it."
        actions={createButton}
      >
        {links.status === 'loading' && <SkeletonRows rows={3} columns={5} label="Loading share links" />}
        {links.status === 'error' && <ErrorState title="Unable to load share links" error={links.error} onRetry={links.reload} />}
        {links.status === 'success' && (links.data.data.length === 0 ? (
          <EmptyState
            compact
            icon="link"
            title="No share links yet"
            description="Create a link to let someone view or download this file. Every link expires, and you can revoke it at any time."
          />
        ) : (
          <ShareLinkTable links={links.data.data} access={access} onChanged={refresh} />
        ))}
      </Panel>

      <CreateShareDialog open={creating} onClose={() => setCreating(false)} file={file} onCreated={refresh} />
    </>
  );
}
