import { Link } from 'react-router';
import { formatDate, formatDateTime, formatTime } from '../../utils/format.js';
import { ACTION_LABELS, describeActivity } from './activityFormat.js';

// A security-log style list: absolute time, event type, what happened, where from.
// `dense` keeps the stacked layout at every width, for narrow panels.
export function ActivityList({ items, folderName, showFile = true, showIp = true, dense = false }) {
  const wide = !dense;
  return (
    <ol className="divide-y divide-line-subtle">
      {items.map((activity) => {
        const { verb, standalone, detail } = describeActivity(activity, folderName);
        const fileName = activity.metadata?.fileName;
        const linkFile = showFile && fileName && activity.fileId;
        return (
          <li
            key={activity.id}
            className={`grid grid-cols-[4.75rem_1fr] gap-x-3 px-4 ${
              wide ? 'py-3 sm:grid-cols-[6.5rem_7.5rem_1fr_auto]' : 'py-2.5'
            }`}
          >
            <time
              dateTime={activity.timestamp}
              title={formatDateTime(activity.timestamp)}
              className={`row-span-3 flex flex-col ${wide ? 'sm:row-span-1' : ''}`}
            >
              <span className="font-mono text-tech text-fg-secondary tabular">{formatTime(activity.timestamp)}</span>
              <span className="text-meta text-fg-muted">{formatDate(activity.timestamp)}</span>
            </time>
            <span className="self-start">
              <span className="inline-block rounded-control border border-line bg-bg-secondary px-1.5 py-px font-mono text-meta tracking-tight text-fg-secondary">
                {ACTION_LABELS[activity.action] ?? activity.action}
              </span>
            </span>
            <div className={`col-start-2 mt-1 min-w-0 ${wide ? 'sm:col-start-3 sm:mt-0' : ''}`}>
              <p className="text-body break-words text-fg">
                {linkFile ? verb : standalone}
                {linkFile && (
                  <>
                    {' '}
                    <Link
                      to={`/app/files/${activity.fileId}`}
                      className="font-medium text-fg underline decoration-line underline-offset-2 hover:decoration-accent"
                    >
                      {fileName}
                    </Link>
                  </>
                )}
              </p>
              {detail && <p className="mt-0.5 text-meta break-words text-fg-muted">{detail}</p>}
            </div>
            {showIp && activity.ip && (
              <span className={`col-start-2 font-mono text-meta text-fg-muted ${wide ? 'sm:col-start-4 sm:self-start sm:text-right' : ''}`}>
                {activity.ip}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
