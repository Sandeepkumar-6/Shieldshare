import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { BrandMark } from '../components/layout/BrandMark.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Icon, fileIconName } from '../components/ui/Icon.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { Notice } from '../components/ui/States.jsx';
import { publicShareApi } from '../services/publicShare.service.js';
import { downloadWith } from '../utils/download.js';
import { formatBytes, formatDateTime } from '../utils/format.js';

// Public page for a share link. No account needed. Every unusable link shows the same
// message: the page never says whether it expired, was revoked or is paused.
function Frame({ children }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark /></div>
        <div className="rounded-dialog border border-line-subtle bg-surface p-6">{children}</div>
        <p className="mt-6 text-center text-meta text-fg-muted">
          Files shared through ShieldShare use links that expire and can be revoked by their owner at any time.
        </p>
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-card border border-line-subtle bg-bg-secondary text-fg-muted">
        <Icon name="link" className="size-5" />
      </div>
      <h1 className="text-heading font-semibold text-fg">This link is no longer available</h1>
      <p className="mt-1 text-body text-fg-secondary">Ask the person who shared it with you for a new link.</p>
    </div>
  );
}

export default function PublicShare() {
  const { token } = useParams();
  const [state, setState] = useState({ phase: 'loading' });
  const [accessToken, setAccessToken] = useState(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const load = useCallback(() => {
    setState({ phase: 'loading' });
    publicShareApi.metadata(token).then(
      (meta) => setState({ phase: 'ready', meta }),
      (error) => setState(error.status === 410 ? { phase: 'unavailable' } : { phase: 'error', error }),
    );
  }, [token]);

  useEffect(() => {
    document.title = 'Shared file · ShieldShare';
    load();
  }, [load]);

  async function unlock(event) {
    event.preventDefault();
    if (!password || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const result = await publicShareApi.unlock(token, password);
      setAccessToken(result.accessToken);
      setPassword('');
    } catch (error) {
      if (error.status === 410) setState({ phase: 'unavailable' });
      else setUnlockError(error);
    } finally {
      setUnlocking(false);
    }
  }

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadWith(() => publicShareApi.download(token, accessToken), state.meta.fileName);
    } catch (error) {
      if (error.status === 410) {
        setState({ phase: 'unavailable' });
      } else if (error.code === 'SHARE_PASSWORD_REQUIRED') {
        setAccessToken(null); // the 10-minute unlock ran out
        setDownloadError(new Error('Your access timed out. Enter the password again to download.'));
      } else {
        setDownloadError(error);
      }
    } finally {
      setDownloading(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <Frame>
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          <span className="sr-only">Loading shared file</span>
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-9 w-full" />
        </div>
      </Frame>
    );
  }

  if (state.phase === 'unavailable') {
    return <Frame><Unavailable /></Frame>;
  }

  if (state.phase === 'error') {
    return (
      <Frame>
        <div role="alert" className="flex flex-col items-center text-center">
          <p className="text-heading font-semibold text-fg">This shared file couldn&apos;t be loaded</p>
          <p className="mt-1 text-body text-fg-secondary">{state.error.message}</p>
          <Button className="mt-4" icon="refresh" onClick={load}>Try again</Button>
        </div>
      </Frame>
    );
  }

  const { meta } = state;
  const locked = meta.requiresPassword && !accessToken;
  return (
    <Frame>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line-subtle bg-bg-secondary text-fg-muted">
          <Icon name={fileIconName(meta.fileName)} className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-heading font-semibold break-all text-fg">{meta.fileName}</h1>
          <p className="text-meta text-fg-muted">
            {formatBytes(meta.size)} · Link expires {formatDateTime(meta.expiresAt)}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {locked ? (
          <form onSubmit={unlock} className="flex flex-col gap-3" noValidate>
            <p className="text-body text-fg-secondary">This link is password protected. Enter the password the owner gave you.</p>
            <Input
              label="Password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={unlockError && unlockError.status === 401 ? unlockError.message : null}
            />
            {unlockError && unlockError.status !== 401 && <Notice tone="critical">{unlockError.message}</Notice>}
            <Button type="submit" variant="primary" icon="lock" loading={unlocking} disabled={!password} className="w-full justify-center">
              Unlock
            </Button>
          </form>
        ) : meta.permission === 'DOWNLOAD' ? (
          <>
            {meta.requiresPassword && <Notice tone="success">Unlocked. You can download the file for the next 10 minutes.</Notice>}
            <Button variant="primary" icon="download" loading={downloading} onClick={download} className="w-full justify-center">
              Download
            </Button>
          </>
        ) : (
          <Notice tone="info" title="View only">
            The owner shared this file&apos;s details but did not allow downloads through this link.
          </Notice>
        )}
        {downloadError && <Notice tone="critical" title="Download failed">{downloadError.message}</Notice>}
      </div>
    </Frame>
  );
}
