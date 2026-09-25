import { useState } from 'react';
import { Input, Select } from '../../components/ui/Field.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { fileApi } from '../../services/file.service.js';
import { downloadFile } from '../../utils/download.js';
import { CreateShareDialog } from '../shares/CreateShareDialog.jsx';

// Rename / move / delete / download for a file, shared by the Files page and File Details.
// Returns openers plus the dialog elements to render once.
export function useFileActions({ folders = [], onChanged, onDeleted }) {
  const toast = useToast();
  const [dialog, setDialog] = useState(null); // { type, file }
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');

  const close = () => setDialog(null);

  function openRename(file) {
    setName(file.name);
    setDialog({ type: 'rename', file });
  }

  function openMove(file) {
    const firstOther = folders.find((folder) => folder.id !== file.folderId);
    setFolderId(firstOther?.id ?? '');
    setDialog({ type: 'move', file });
  }

  function openDelete(file) {
    setDialog({ type: 'delete', file });
  }

  function openShare(file) {
    setDialog({ type: 'share', file });
  }

  async function download(file, { versionId, versionNumber, name: versionName } = {}) {
    try {
      await downloadFile(file.id, { versionId, fallbackName: versionName ?? file.name });
      toast.info('Download started', versionNumber ? `${versionName ?? file.name} (v${versionNumber})` : file.name);
    } catch (error) {
      toast.error('Download failed', error.message);
    }
  }

  const file = dialog?.file;
  const folderName = (id) => folders.find((folder) => folder.id === id)?.name;

  const dialogs = (
    <>
      <CreateShareDialog
        open={dialog?.type === 'share'}
        onClose={close}
        file={dialog?.type === 'share' ? file : null}
        onCreated={() => onChanged?.(file)}
      />

      <ConfirmDialog
        open={dialog?.type === 'rename'}
        onClose={close}
        title="Rename file"
        confirmLabel="Rename"
        confirmDisabled={!name.trim() || name.trim() === file?.name}
        onConfirm={async () => {
          const updated = await fileApi.update(file.id, { name });
          toast.success('File renamed', `${file.name} → ${updated.name}`);
          onChanged?.(updated);
        }}
      >
        <Input
          data-autofocus
          label="File name"
          value={name}
          maxLength={255}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => {
            // Select the name without its extension, the part people usually change.
            const dot = event.target.value.lastIndexOf('.');
            event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length);
          }}
          hint="Renaming is recorded in the file's activity."
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'move'}
        onClose={close}
        title="Move file"
        confirmLabel="Move"
        confirmDisabled={!folderId}
        onConfirm={async () => {
          const updated = await fileApi.update(file.id, { folderId });
          toast.success('File moved', `${updated.name} is now in ${folderName(updated.folderId) ?? 'another folder'}`);
          onChanged?.(updated);
        }}
      >
        {folders.filter((folder) => folder.id !== file?.folderId).length === 0 ? (
          <p className="text-body text-fg-secondary">
            There is no other folder to move this file to. Create a folder on the Files page first.
          </p>
        ) : (
          <Select
            label={`Move ${file?.name ?? ''} to`}
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            {folders.filter((folder) => folder.id !== file?.folderId).map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </Select>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        onClose={close}
        tone="danger"
        title={`Delete ${file?.name ?? 'file'}?`}
        confirmLabel="Delete file"
        onConfirm={async () => {
          await fileApi.remove(file.id);
          toast.success('File deleted', file.name);
          onDeleted?.(file);
        }}
      >
        <p className="text-body text-fg-secondary">
          The file is removed from your files. ShieldShare keeps its stored versions, so deleted files are
          retained for recovery rather than destroyed.
        </p>
      </ConfirmDialog>
    </>
  );

  return { openRename, openMove, openDelete, openShare, download, dialogs };
}
