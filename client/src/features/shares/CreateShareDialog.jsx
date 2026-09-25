import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Checkbox, Input, Select } from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Notice } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { shareApi } from '../../services/share.service.js';
import { formatDateTime } from '../../utils/format.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 30; // server default (SHARE_MAX_EXPIRY_DAYS); the server has the final say
const PRESETS = [
  { value: '1', label: '24 hours' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'custom', label: 'Pick a date' },
];
const MIN_PASSWORD = 8;

const toDateInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

function expiryFrom(preset, customDate) {
  if (preset !== 'custom') return new Date(Date.now() + Number(preset) * DAY_MS);
  if (!customDate) return null;
  const [year, month, day] = customDate.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 0); // end of the chosen day, local time
}

const INITIAL = { permission: 'DOWNLOAD', preset: '7', customDate: '', recipientLabel: '', usePassword: false, password: '' };

export function CreateShareDialog({ open, onClose, file, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null); // { share, url }

  useEffect(() => {
    if (open) {
      setForm(INITIAL);
      setError(null);
      setBusy(false);
      setCreated(null);
    }
  }, [open]);

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((values) => ({ ...values, [field]: value }));
  };

  const expiry = expiryFrom(form.preset, form.customDate);
  const passwordError = form.usePassword && form.password.length > 0 && form.password.length < MIN_PASSWORD
    ? `Use at least ${MIN_PASSWORD} characters.`
    : null;
  const canSubmit = expiry && (!form.usePassword || form.password.length >= MIN_PASSWORD);

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await shareApi.create(file.id, {
        permission: form.permission,
        expiresAt: expiry.toISOString(),
        recipientLabel: form.recipientLabel,
        password: form.usePassword ? form.password : undefined,
      });
      setCreated(result);
      onCreated?.(result.share);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy', 'Select the link and copy it manually.');
    }
  }

  if (created) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Link created"
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}
      >
        <div className="flex flex-col gap-4">
          <Notice tone="warning" title="Copy this link now">
            You won&apos;t see it again. ShieldShare stores only a fingerprint of the link, so it can&apos;t show it later.
            If you lose it, create a new link.
          </Notice>
          <div className="flex gap-2">
            <Input
              data-autofocus
              aria-label="Share link"
              readOnly
              value={created.url}
              onFocus={(event) => event.target.select()}
              className="flex-1"
              inputClassName="font-mono text-tech"
            />
            <Button variant="primary" icon="copy" onClick={copy}>Copy</Button>
          </div>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-body">
            <dt className="text-meta text-fg-muted">Recipient can</dt>
            <dd className="text-fg">{created.share.permission === 'DOWNLOAD' ? 'View details and download' : 'View details only'}</dd>
            <dt className="text-meta text-fg-muted">Expires</dt>
            <dd className="text-fg">{formatDateTime(created.share.expiresAt)}</dd>
            <dt className="text-meta text-fg-muted">Password</dt>
            <dd className="text-fg">{created.share.passwordProtected ? 'Required. Send it separately from the link.' : 'None'}</dd>
          </dl>
        </div>
      </Modal>
    );
  }

  const today = new Date();
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="Create share link"
      description={file ? `Anyone with the link can use it until it expires or you revoke it. File: ${file.name}` : undefined}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon="link" loading={busy} disabled={!canSubmit} onClick={submit}>Create link</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-meta font-medium text-fg-secondary">Recipient can</legend>
          {[
            { value: 'DOWNLOAD', label: 'View details and download', hint: 'They see the file name and size and can download the current version.' },
            { value: 'VIEW', label: 'View details only', hint: 'They see the file name and size. Downloading is not allowed.' },
          ].map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-control border px-3 py-2.5 ${
                form.permission === option.value ? 'border-accent/60 bg-accent/5' : 'border-line-subtle hover:border-line'
              }`}
            >
              <input
                type="radio"
                name="permission"
                value={option.value}
                checked={form.permission === option.value}
                onChange={set('permission')}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-body text-fg">{option.label}</span>
                <span className="block text-meta text-fg-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Expires after" value={form.preset} onChange={set('preset')}>
            {PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </Select>
          {form.preset === 'custom' ? (
            <Input
              label="Expiry date"
              type="date"
              value={form.customDate}
              min={toDateInput(today)}
              max={toDateInput(new Date(today.getTime() + (MAX_DAYS - 1) * DAY_MS))}
              onChange={set('customDate')}
              hint="The link stops working at the end of this day."
            />
          ) : (
            <div className="flex flex-col justify-end pb-2 text-meta text-fg-muted">
              {expiry && <>Stops working {formatDateTime(expiry)}</>}
            </div>
          )}
        </div>

        <Input
          label="Recipient label (optional)"
          placeholder="e.g. bob@example.com"
          maxLength={254}
          value={form.recipientLabel}
          onChange={set('recipientLabel')}
          hint="Only you see this. It does not restrict who can open the link."
        />

        <div className="flex flex-col gap-2">
          <Checkbox
            label="Require a password"
            checked={form.usePassword}
            onChange={set('usePassword')}
            hint="The recipient must enter it before downloading."
          />
          {form.usePassword && (
            <Input
              label="Link password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              error={passwordError}
              hint={`At least ${MIN_PASSWORD} characters. Send it separately from the link.`}
            />
          )}
        </div>

        {error && <Notice tone="critical" title="Link not created">{error.message}</Notice>}
      </form>
    </Modal>
  );
}
