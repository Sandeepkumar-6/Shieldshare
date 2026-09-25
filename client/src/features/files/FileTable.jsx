import { Link } from 'react-router';
import { FileStatusBadge } from '../../components/ui/Badge.jsx';
import { Icon, fileIconName } from '../../components/ui/Icon.jsx';
import { Menu } from '../../components/ui/Menu.jsx';
import { formatBytes, formatDateTime, formatRelative } from '../../utils/format.js';

const SORTABLE = [
  { field: 'name', label: 'Name' },
  { field: 'size', label: 'Size' },
  { field: 'updatedAt', label: 'Modified' },
];

function SortHeader({ field, label, sort, onSortChange, className = '' }) {
  const active = sort.replace('-', '') === field;
  const descending = sort.startsWith('-');
  const next = active && !descending ? `-${field}` : field;
  return (
    <th
      scope="col"
      aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
      className={`px-4 py-2.5 text-left text-meta font-medium text-fg-muted ${className}`}
    >
      <button
        type="button"
        onClick={() => onSortChange(next)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-control hover:text-fg"
      >
        {label}
        {active && <Icon name={descending ? 'chevronDown' : 'chevronUp'} className="size-3.5" />}
      </button>
    </th>
  );
}

export function FileTable({ files, folderName, showFolder, sort, onSortChange, actions, access }) {
  const sortProps = { sort, onSortChange };
  const header = Object.fromEntries(SORTABLE.map((column) => [column.field, column]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-collapse text-body">
        <thead className="border-b border-line-subtle">
          <tr>
            {/* The name column takes the remaining width; the rest size to content */}
            <SortHeader {...header.name} {...sortProps} className="w-full" />
            {showFolder && <th scope="col" className="hidden px-4 py-2.5 text-left text-meta font-medium whitespace-nowrap text-fg-muted lg:table-cell">Folder</th>}
            <SortHeader {...header.size} {...sortProps} className="hidden whitespace-nowrap sm:table-cell" />
            <th scope="col" className="hidden px-4 py-2.5 text-left text-meta font-medium whitespace-nowrap text-fg-muted md:table-cell">Version</th>
            <SortHeader {...header.updatedAt} {...sortProps} className="hidden whitespace-nowrap sm:table-cell" />
            <th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {files.map((file) => {
            const underReview = file.status === 'QUARANTINED';
            const writeBlocked = access.reason ?? (underReview ? 'This file is under review.' : null);
            const writeHint = access.hint ?? (underReview ? 'File is under review' : null);
            return (
              <tr key={file.id} className="transition-colors duration-150 hover:bg-surface-hover/50">
                <td className="max-w-0 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon name={fileIconName(file.name)} className="size-5 text-fg-muted" />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          to={`/app/files/${file.id}`}
                          className="truncate font-medium text-fg hover:text-accent hover:underline hover:underline-offset-2"
                          title={file.name}
                        >
                          {file.name}
                        </Link>
                        {file.status !== 'ACTIVE' && <FileStatusBadge status={file.status} />}
                      </div>
                      <p className="text-meta text-fg-muted sm:hidden">
                        {formatBytes(file.size)} · v{file.currentVersion} · {formatRelative(file.updatedAt)}
                      </p>
                    </div>
                  </div>
                </td>
                {showFolder && (
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-fg-secondary lg:table-cell">
                    <span className="block max-w-40 truncate">{folderName(file.folderId) ?? '—'}</span>
                  </td>
                )}
                <td className="hidden px-4 py-2.5 whitespace-nowrap text-fg-secondary tabular sm:table-cell">{formatBytes(file.size)}</td>
                <td className="hidden px-4 py-2.5 font-mono text-tech text-fg-secondary md:table-cell">v{file.currentVersion}</td>
                <td className="hidden px-4 py-2.5 whitespace-nowrap text-fg-secondary sm:table-cell">
                  <time dateTime={file.updatedAt} title={formatDateTime(file.updatedAt)}>{formatRelative(file.updatedAt)}</time>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Menu
                    label={`Actions for ${file.name}`}
                    items={[
                      {
                        label: 'Download',
                        icon: 'download',
                        onSelect: () => actions.download(file),
                        disabledReason: underReview ? 'This file is under review.' : null,
                        disabledHint: 'File is under review',
                      },
                      { label: 'Share', icon: 'link', onSelect: () => actions.openShare(file), disabledReason: writeBlocked, disabledHint: writeHint },
                      { label: 'Rename', icon: 'pencil', onSelect: () => actions.openRename(file), disabledReason: writeBlocked, disabledHint: writeHint },
                      { label: 'Move', icon: 'folderMove', onSelect: () => actions.openMove(file), disabledReason: writeBlocked, disabledHint: writeHint },
                      { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => actions.openDelete(file), disabledReason: writeBlocked, disabledHint: writeHint },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
