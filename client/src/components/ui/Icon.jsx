// A small, hand-drawn stroke icon set (24×24). Icons are used only where they carry meaning:
// navigation, file types, actions and status (skill §11). Decorative by default: pair them
// with visible text, or pass `label` when an icon stands alone.

const ICONS = {
  overview: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  folder: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />,
  folderPlus: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </>
  ),
  folderMove: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      <path d="M9 13.5h6M13 11.5l2 2-2 2" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  shield: <path d="M12 3.5l7 2.8v5.2c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6.3z" />,
  shieldCheck: (
    <>
      <path d="M12 3.5l7 2.8v5.2c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6.3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />,
  logout: <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 16l4-4-4-4M20 12H9" />,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  upload: <path d="M12 15V4.5M7.5 9L12 4.5 16.5 9M4.5 15v3A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />,
  download: <path d="M12 4.5V15M7.5 10.5L12 15l4.5-4.5M4.5 15v3A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />,
  more: (
    <>
      <circle cx="12" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </>
  ),
  file: <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5" />,
  fileText: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5" />
      <path d="M9 12.5h6M9 16h6" />
    </>
  ),
  fileSheet: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5" />
      <path d="M8.5 12h7v5.5h-7zM8.5 14.75h7M12 12v5.5" />
    </>
  ),
  fileImage: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5" />
      <path d="M8 17.5l2.5-3 2 2 1.5-1.5 2 2.5" />
    </>
  ),
  fileArchive: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5" />
      <path d="M10.5 4v1.5M10.5 7.5V9M10.5 11v1.5M9.5 14.5h2v2.5h-2z" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.9" />
    </>
  ),
  alert: <path d="M12 4.5l8.5 15h-17zM12 10v4M12 16.8v.2" />,
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 15.8v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.2" />
    </>
  ),
  refresh: <path d="M19.5 11.5A7.5 7.5 0 1 0 17.3 17M19.5 5v6.5H13" />,
  copy: <path d="M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5zM15.5 8V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H9" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  history: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4M12 8v4l2.8 1.8" />,
  pencil: <path d="M4.5 19.5h4l10-10-4-4-10 10zM13 7l4 4" />,
  trash: <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M9.5 7V4.5h5V7" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  arrowLeft: <path d="M19 12H5.5M11 6.5L5.5 12l5.5 5.5" />,
  monitor: <path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 16H5a1.5 1.5 0 0 1-1.5-1.5zM8.5 20h7M12 16v4" />,
  fingerprint: <path d="M5 9h14M5 15h14M10.5 4l-2 16M15.5 4l-2 16" />,
  restore: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4" />,
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14zM10 20.5h4" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c.6-3 3-4.8 6-4.8s5.4 1.8 6 4.8M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.9c1.8.7 3 2.3 3.5 4.6" />
    </>
  ),
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2" />,
  unlock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2M12 14.5v2" />,
  incident: <path d="M8.3 3.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 16.2V8.8zM12 8v4.5M12 15.8v.2" />,
  chart: <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />,
  message: <path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" />,
  // Assistant: a speech bubble with a reply mark, deliberately not a sparkle (skill §11, §52).
  assistant: (
    <>
      <path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" />
      <path d="M8.5 10.5h7M8.5 8h4" />
    </>
  ),
  send: <path d="M4.5 12L19.5 5l-4 14.5-3.5-6.5zM12 13l7.5-8" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" />
    </>
  ),
  moon: <path d="M19.5 14.2A7.5 7.5 0 0 1 9.8 4.5a7.5 7.5 0 1 0 9.7 9.7z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  expand: <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5L13 11M4.5 19.5L11 13" />,
  arrowUpRight: <path d="M7.5 16.5l9-9M9 7.5h7.5V15" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.6M12 16.8v.2" />
    </>
  ),
  audit: <path d="M8.5 4.5h7M8 3h8v3H8zM6 4.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-1M8 11h8M8 15h5" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
};

export function Icon({ name, className = 'size-4', label, strokeWidth = 1.6 }) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

// File-type glyph from the name's extension.
export function fileIconName(name = '') {
  const ext = name.toLowerCase().split('.').pop();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'fileImage';
  if (['csv', 'xls', 'xlsx'].includes(ext)) return 'fileSheet';
  if (['zip'].includes(ext)) return 'fileArchive';
  if (['txt', 'md', 'json', 'doc', 'docx', 'pdf', 'ppt', 'pptx'].includes(ext)) return 'fileText';
  return 'file';
}
