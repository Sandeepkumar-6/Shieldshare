import { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Select } from '../../components/ui/Field.jsx';
import { HashText } from '../../components/ui/HashText.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Panel } from '../../components/ui/Layout.jsx';
import { Notice } from '../../components/ui/States.jsx';
import { fileApi } from '../../services/file.service.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';

// "SHA-256 verified" is only ever shown after a verification that passed, with its time
// (spec §12). A fresh upload or new version is "recorded", not "verified".
export function VerificationStatus({ file }) {
  if (file.lastVerifiedAt) {
    return (
      <p className="inline-flex items-center gap-1.5 text-body text-success">
        <Icon name="shieldCheck" className="size-4" />
        SHA-256 verified
        <time dateTime={file.lastVerifiedAt} title={formatDateTime(file.lastVerifiedAt)} className="text-fg-muted">
          {formatRelative(file.lastVerifiedAt)}
        </time>
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-1.5 text-body text-fg-secondary">
      <Icon name="clock" className="size-4 text-fg-muted" />
      Not verified since v{file.currentVersion} was created
    </p>
  );
}

function VerificationResult({ result }) {
  const rows = [
    ['Recorded', result.expected],
    ['Recomputed', result.actual],
  ];
  return (
    <div
      role="status"
      className={`rounded-control border px-3.5 py-3 ${result.passed ? 'border-success/25 bg-success/5' : 'border-critical/30 bg-critical/5'}`}
    >
      <p className={`flex items-center gap-2 text-body font-medium ${result.passed ? 'text-success' : 'text-critical'}`}>
        <Icon name={result.passed ? 'checkCircle' : 'alertCircle'} className="size-4" />
        {result.passed ? `SHA-256 verified · v${result.versionNumber}` : `Integrity check failed · v${result.versionNumber}`}
      </p>
      <p className="mt-1 text-meta text-fg-secondary">
        {result.passed
          ? 'The stored bytes match the fingerprint recorded when this version was created.'
          : result.actual
            ? 'The stored bytes no longer match the fingerprint recorded for this version.'
            : 'The stored content for this version could not be read.'}
        {' '}Checked {formatDateTime(result.verifiedAt)}.
      </p>
      <dl className="mt-3 flex flex-col gap-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[6rem_1fr] gap-2">
            <dt className="text-meta text-fg-muted">{label}</dt>
            <dd className="min-w-0 font-mono text-tech break-all text-fg-secondary">{value ?? 'unreadable'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function IntegrityPanel({ file, versions, onVerified }) {
  const current = versions.find((version) => version.isCurrent);
  const [versionId, setVersionId] = useState(current?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await fileApi.verify(file.id, versionId || undefined);
      setResult(outcome);
      onVerified?.(outcome);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="SHA-256 fingerprint" description={`Current version · v${file.currentVersion}`}>
        <div className="flex flex-col gap-3 px-4 py-4">
          <HashText hash={file.sha256} full />
          {current && (
            <p className="text-meta text-fg-muted">
              Recorded when v{current.versionNumber} was created on {formatDateTime(current.createdAt)}.
              Every version keeps its own fingerprint; see the Versions tab.
            </p>
          )}
          <VerificationStatus file={file} />
        </div>
      </Panel>

      <Panel
        title="Integrity verification"
        description="Reads the stored bytes, recomputes SHA-256 and compares it with the recorded fingerprint."
      >
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Select
              label="Version to verify"
              className="sm:w-56"
              value={versionId}
              onChange={(event) => {
                setVersionId(event.target.value);
                setResult(null);
              }}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.versionNumber}{version.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </Select>
            <Button variant="primary" icon="shieldCheck" loading={busy} onClick={verify}>
              Verify integrity
            </Button>
          </div>
          {result && <VerificationResult result={result} />}
          {error && <Notice tone="critical" title="Verification could not run">{error.message}</Notice>}
        </div>
      </Panel>

      <Panel
        title="Entropy by version"
        description="Shannon entropy in bits per byte. An increase can support other evidence; a high value alone is not proof of ransomware."
        className="lg:col-span-2"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-body">
            <thead className="border-b border-line-subtle text-left text-meta text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Version</th>
                <th scope="col" className="px-4 py-2 font-medium">Created</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Entropy</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {[...versions].reverse().map((version, index, ordered) => {
                const previous = ordered[index - 1];
                const delta = Number.isFinite(previous?.entropy) && Number.isFinite(version.entropy)
                  ? version.entropy - previous.entropy
                  : null;
                return (
                  <tr key={version.id}>
                    <td className="px-4 py-2 font-mono text-tech text-fg">v{version.versionNumber}{version.isCurrent ? ' · current' : ''}</td>
                    <td className="px-4 py-2 text-fg-secondary">{formatDateTime(version.createdAt)}</td>
                    <td className="px-4 py-2 text-right font-mono text-tech">{Number.isFinite(version.entropy) ? version.entropy.toFixed(2) : '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-tech text-fg-secondary">{delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
