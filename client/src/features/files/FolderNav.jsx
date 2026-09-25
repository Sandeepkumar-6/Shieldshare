import { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { Menu } from '../../components/ui/Menu.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Skeleton } from '../../components/ui/Skeleton.jsx';
import { ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { folderApi } from '../../services/folder.service.js';

export const ALL_FILES = 'all';

function FolderButton({ selected, onClick, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left text-body transition-colors duration-150 ${
        selected ? 'bg-surface-elevated font-medium text-fg' : 'text-fg-secondary hover:bg-surface hover:text-fg'
      }`}
    >
      <Icon name={icon} className={`size-4 ${selected ? 'text-accent' : 'text-fg-muted'}`} />
      <span className="truncate">{children}</span>
    </button>
  );
}

export function FolderNav({ folders, selected, onSelect, access, onChanged }) {
  const toast = useToast();
  const [dialog, setDialog] = useState(null); // { type: 'create' | 'rename' | 'delete', folder? }
  const [name, setName] = useState('');

  const openCreate = () => {
    setName('');
    setDialog({ type: 'create' });
  };
  const close = () => setDialog(null);

  const list = folders.data ?? [];

  return (
    <>
      {/* Desktop: vertical list */}
      <nav aria-label="Folders" className="hidden lg:block">
        <div className="flex items-center justify-between pb-2 pl-2.5">
          <h2 className="text-meta font-medium text-fg-muted">Folders</h2>
          <Button size="icon" variant="ghost" icon="folderPlus" aria-label="New folder" disabledReason={access.reason} onClick={openCreate} />
        </div>
        {folders.status === 'loading' && (
          <div className="flex flex-col gap-2" aria-hidden="true">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-7 w-full" />)}
          </div>
        )}
        {folders.status === 'error' && <ErrorState compact title="Folders unavailable" error={folders.error} onRetry={folders.reload} />}
        {folders.status === 'success' && (
          <ul className="flex flex-col gap-0.5">
            <li className="flex">
              <FolderButton icon="file" selected={selected === ALL_FILES} onClick={() => onSelect(ALL_FILES)}>
                All files
              </FolderButton>
            </li>
            {list.map((folder) => (
              <li key={folder.id} className="group flex items-center gap-0.5">
                <FolderButton icon="folder" selected={selected === folder.id} onClick={() => onSelect(folder.id)}>
                  {folder.name}
                </FolderButton>
                {!folder.isRoot && (
                  <Menu
                    label={`Actions for folder ${folder.name}`}
                    triggerClassName="size-7"
                    items={[
                      {
                        label: 'Rename',
                        icon: 'pencil',
                        disabledReason: access.reason,
                        disabledHint: access.hint,
                        onSelect: () => {
                          setName(folder.name);
                          setDialog({ type: 'rename', folder });
                        },
                      },
                      {
                        label: 'Delete',
                        icon: 'trash',
                        tone: 'danger',
                        disabledReason: access.reason,
                        disabledHint: access.hint,
                        onSelect: () => setDialog({ type: 'delete', folder }),
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* Mobile: compact picker */}
      <div className="flex items-end gap-2 lg:hidden">
        <Select
          label="Folder"
          className="flex-1"
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
          disabled={folders.status !== 'success'}
        >
          <option value={ALL_FILES}>All files</option>
          {list.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </Select>
        <Button icon="folderPlus" disabledReason={access.reason} onClick={openCreate}>New folder</Button>
      </div>

      <ConfirmDialog
        open={dialog?.type === 'create' || dialog?.type === 'rename'}
        onClose={close}
        title={dialog?.type === 'rename' ? 'Rename folder' : 'New folder'}
        confirmLabel={dialog?.type === 'rename' ? 'Rename' : 'Create folder'}
        confirmDisabled={!name.trim() || (dialog?.type === 'rename' && name.trim() === dialog.folder.name)}
        onConfirm={async () => {
          if (dialog.type === 'rename') {
            const folder = await folderApi.rename(dialog.folder.id, name);
            toast.success('Folder renamed', folder.name);
          } else {
            const folder = await folderApi.create(name);
            toast.success('Folder created', folder.name);
            onSelect(folder.id);
          }
          onChanged();
        }}
      >
        <Input
          data-autofocus
          label="Folder name"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        onClose={close}
        tone="danger"
        title={`Delete folder ${dialog?.folder?.name ?? ''}?`}
        confirmLabel="Delete folder"
        onConfirm={async () => {
          await folderApi.remove(dialog.folder.id);
          toast.success('Folder deleted', dialog.folder.name);
          if (selected === dialog.folder.id) onSelect(ALL_FILES);
          onChanged();
        }}
      >
        <p className="text-body text-fg-secondary">
          Only empty folders can be deleted. Files you deleted from this folder are kept for recovery, so a
          folder that held them stays.
        </p>
      </ConfirmDialog>
    </>
  );
}
