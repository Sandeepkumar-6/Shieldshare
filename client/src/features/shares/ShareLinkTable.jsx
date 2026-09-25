import { useState } from 'react';
import { Link } from 'react-router';
import { PermissionBadge, ShareStatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { shareApi } from '../../services/share.service.js';
import { formatDate, formatDateTime, formatRelative, pluralize } from '../../utils/format.js';

function statusNote(link) {
  if (link.status !== 'SUSPENDED') return null;
  if (link.fileStatus === 'QUARANTINED') return 'Paused while the file is under review';
  if (link.fileStatus === 'DELETED') return 'The file was deleted';
  return 'Paused';
}

// The date, plus what it means for this link now.
function expiryNote(link) {
  if (link.status === 'REVOKED') return link.revokedAt ? `revoked ${formatRelative(link.revokedAt)}` : 'revoked';
  if (link.status === 'EXPIRED') return 'expired';
  return formatRelative(link.expiresAt, { maxDays: 31 });
}

const REVOCABLE = ['ACTIVE', 'SUSPENDED'];

function FileName({ link }) {
  return link.fileStatus && link.fileStatus !== 'DELETED' ? (
    <Link to={`/app/files/${link.fileId}?tab=sharing`} className="block truncate font-medium text-fg hover:text-accent" title={link.fileName}>
      {link.fileName}
    </Link>
  ) : (
    <span className="block truncate font-medium text-fg-secondary" title={link.fileName ?? undefined}>{link.fileName ?? 'Unknown file'}</span>
  );
}

function Recipient({ link, muted }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${muted ? 'text-meta text-fg-muted' : 'text-fg'}`}>
      <span className="truncate">{link.recipientLabel ?? <span className="text-fg-muted">No recipient label</span>}</span>
      {link.passwordProtected && (
        <span className="inline-flex shrink-0 items-center text-fg-muted" title="Password required">
          <Icon name="lock" className="size-3.5" />
          <span className="sr-only">Password required</span>
        </span>
      )}
    </span>
  );
}

export function ShareLinkTable({ links, showFile = false, access, onChanged }) {
  const toast = useToast();
  const [target, setTarget] = useState(null);

  const revokeButton = (link) => REVOCABLE.includes(link.status) && (
    <Button size="sm" variant="danger-ghost" disabledReason={access.reason} onClick={() => setTarget(link)}>
      Revoke
    </Button>
  );

  return (
    <>
      {/* Small screens: one card per link, nothing hidden off to the side. */}
      <ul className="divide-y divide-line-subtle sm:hidden">
        {links.map((link) => (
          <li key={link.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="min-w-0">
              {showFile && <FileName link={link} />}
              <Recipient link={link} muted={showFile} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ShareStatusBadge status={link.status} />
              <PermissionBadge permission={link.permission} />
            </div>
            {statusNote(link) && <p className="text-meta text-fg-muted">{statusNote(link)}</p>}
            <div className="flex items-center justify-between gap-3">
              <p className="text-meta text-fg-muted">
                Expires {formatDate(link.expiresAt)} ({expiryNote(link)}) · opened {pluralize(link.accessCount, 'time')}
              </p>
              {revokeButton(link)}
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[44rem] border-collapse text-body">
          <thead className="border-b border-line-subtle">
            <tr className="text-left text-meta text-fg-muted">
              <th scope="col" className="w-full px-4 py-2.5 font-medium">{showFile ? 'File and recipient' : 'Recipient'}</th>
              <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">Access</th>
              <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">Expires</th>
              <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">Opened</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {links.map((link) => (
              <tr key={link.id}>
                <td className="max-w-0 px-4 py-3">
                  {showFile && <FileName link={link} />}
                  <Recipient link={link} muted={showFile} />
                  <span className="text-meta text-fg-muted">Created {formatDate(link.createdAt)}</span>
                </td>
                <td className="px-4 py-3"><PermissionBadge permission={link.permission} /></td>
                <td className="px-4 py-3">
                  <ShareStatusBadge status={link.status} />
                  {statusNote(link) && <p className="mt-0.5 text-meta whitespace-nowrap text-fg-muted">{statusNote(link)}</p>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <time dateTime={link.expiresAt} title={formatDateTime(link.expiresAt)} className="text-fg-secondary">
                    {formatDate(link.expiresAt)}
                  </time>
                  <p className="text-meta text-fg-muted">{expiryNote(link)}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">
                  <span className="tabular">{pluralize(link.accessCount, 'time')}</span>
                  {link.lastAccessedAt && (
                    <p className="text-meta text-fg-muted" title={formatDateTime(link.lastAccessedAt)}>last {formatRelative(link.lastAccessedAt)}</p>
                  )}
                </td>
                <td className="px-4 py-2 text-right">{revokeButton(link)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        tone="danger"
        title="Revoke this link?"
        confirmLabel="Revoke link"
        onConfirm={async () => {
          await shareApi.revoke(target.id);
          toast.success('Link revoked', target.recipientLabel ?? target.fileName ?? undefined);
          onChanged?.();
        }}
      >
        {target && (
          <p className="text-body text-fg-secondary">
            The link to <span className="text-fg">{target.fileName}</span>
            {target.recipientLabel && <> for <span className="text-fg">{target.recipientLabel}</span></>} stops working
            immediately, for everyone who has it. This can&apos;t be undone; create a new link if you need one.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
