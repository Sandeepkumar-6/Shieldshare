import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button.jsx';
import { Icon, fileIconName } from '../../components/ui/Icon.jsx';
import { ProgressBar } from '../../components/ui/ProgressBar.jsx';
import { formatBytes, shortHash } from '../../utils/format.js';

// Retrying only helps when the failure was transient (network, server, conflict, rate
// limit). A rejected type, size or name will be rejected again.
function isRetryable(error) {
  const status = error?.status ?? 0;
  return status === 0 || status >= 500 || status === 409 || status === 429;
}

function UploadStatus({ item }) {
  switch (item.status) {
    case 'queued':
      return <span className="text-fg-muted">Waiting</span>;
    case 'uploading':
      return <span className="tabular text-fg-secondary">Uploading · {Math.round(item.progress * 100)}%</span>;
    case 'processing':
      return <span className="text-fg-secondary">Sent · server is validating, hashing and creating the version</span>;
    case 'done':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-secondary">
          <span className="inline-flex items-center gap-1 text-success">
            <Icon name="checkCircle" className="size-3.5" />
            Version {item.result.version.versionNumber} created
          </span>
          <span>
            SHA-256 <code className="font-mono text-tech" title={item.result.file.sha256}>{shortHash(item.result.file.sha256, 10, 6)}</code>
          </span>
        </span>
      );
    case 'error':
      return <span className="text-critical">{item.error?.message}</span>;
    default:
      return null;
  }
}

export function UploadPanel({ queue, folderId, folderLabel, access }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const blocked = !access.canWrite;
  const finished = queue.items.some((item) => item.status === 'done' || item.status === 'error');

  function addFiles(fileList) {
    if (blocked || !fileList?.length) return;
    queue.enqueue(fileList, folderId);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          if (blocked) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-3 rounded-card border border-dashed px-4 py-5 text-center transition-colors duration-150 sm:flex-row sm:text-left ${
          blocked
            ? 'border-line-subtle bg-surface opacity-70'
            : dragging
              ? 'border-accent bg-accent/5'
              : 'border-line bg-surface'
        }`}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line-subtle bg-bg-secondary text-fg-muted">
          <Icon name={blocked ? 'pause' : 'upload'} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          {blocked ? (
            <>
              <p className="text-body font-medium text-fg">Uploads are paused</p>
              <p className="text-meta text-fg-muted">{access.reason}</p>
            </>
          ) : (
            <>
              <p className="text-body font-medium text-fg">Drop files here to upload to {folderLabel}</p>
              <p className="text-meta text-fg-muted">
                Each file is validated, its SHA-256 fingerprint is recorded and version 1 is created.
              </p>
            </>
          )}
        </div>
        <Button
          variant="primary"
          icon="upload"
          disabledReason={access.reason}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {queue.items.length > 0 && (
        <div className="rounded-card border border-line-subtle bg-surface">
          <div className="flex items-center justify-between border-b border-line-subtle px-4 py-2">
            <p className="text-meta font-medium text-fg-secondary">Uploads</p>
            {finished && (
              <Button size="sm" variant="ghost" onClick={queue.clearFinished}>Clear finished</Button>
            )}
          </div>
          <ul className="divide-y divide-line-subtle" aria-live="polite">
            {queue.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <Icon name={fileIconName(item.file.name)} className="mt-0.5 size-4 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    {item.status === 'done' ? (
                      <Link to={`/app/files/${item.result.file.id}`} className="truncate text-body font-medium text-fg hover:text-accent">
                        {item.result.file.name}
                      </Link>
                    ) : (
                      <span className="truncate text-body font-medium text-fg">{item.file.name}</span>
                    )}
                    <span className="shrink-0 text-meta text-fg-muted tabular">{formatBytes(item.file.size)}</span>
                  </div>
                  <p className="mt-0.5 text-meta"><UploadStatus item={item} /></p>
                  {(item.status === 'uploading' || item.status === 'processing') && (
                    <div className="mt-1.5">
                      <ProgressBar
                        label={`Uploading ${item.file.name}`}
                        value={item.progress}
                        indeterminate={item.status === 'processing'}
                      />
                    </div>
                  )}
                </div>
                {item.status === 'error' && (
                  <div className="flex shrink-0 gap-1">
                    {isRetryable(item.error) && (
                      <Button size="sm" variant="ghost" icon="refresh" onClick={() => queue.retry(item.id)} disabledReason={access.reason}>
                        Retry
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" icon="close" aria-label={`Dismiss ${item.file.name}`} onClick={() => queue.dismiss(item.id)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
