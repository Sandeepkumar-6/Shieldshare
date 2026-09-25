import { LegalPage } from './LegalPage.jsx';

// What ShieldShare actually stores and sends (checked against the server code), in plain
// language. Keep in sync with docs/api/api-contract.md when data handling changes.

const SECTIONS = [
  {
    id: 'stored',
    title: 'What ShieldShare stores',
    content: (
      <ul>
        <li><strong className="text-fg">Account:</strong> your name, email address, a bcrypt hash of your password (never the password itself), your role and account status.</li>
        <li><strong className="text-fg">Sessions:</strong> the IP address and browser description (user agent) of each sign-in, and when it was last used.</li>
        <li><strong className="text-fg">Files:</strong> the content you upload, every version of it, file and folder names, sizes, SHA-256 hashes and entropy values. File content is stored on the server&apos;s disk under random names; ShieldShare does not encrypt it at rest.</li>
        <li><strong className="text-fg">Activity:</strong> a record of each upload, download, change, rename, move, delete, restore, share and sign-in, with the time, IP address, and the names, hashes and sizes before and after.</li>
        <li><strong className="text-fg">Share links:</strong> a hash of each link&apos;s token (the link itself is shown to you once and not stored), its permission, expiry, optional password hash and access count. Opening a link records the visitor&apos;s IP address.</li>
        <li><strong className="text-fg">Security records:</strong> risk evaluations, security incidents, alerts, quarantine records, administrator file-access requests and a log of every administrator action.</li>
        <li><strong className="text-fg">Canary files:</strong> each workspace contains a few hidden decoy files. Changing one is recorded as a security event.</li>
        <li><strong className="text-fg">Assistant conversations:</strong> your questions, the answers, and the records the assistant looked up to answer them. Member conversations are private to that member; administrator investigations are private to that administrator.</li>
      </ul>
    ),
  },
  {
    id: 'monitoring',
    title: 'How your activity is monitored',
    content: (
      <>
        <p>
          Every change you make to a file is scored for ransomware-like patterns as it happens. If the
          score reaches Critical, your account can be frozen automatically (you keep read access) and
          the affected files quarantined until an administrator reviews them. You are told that your
          files are under review; the scores and incident details are visible to administrators only.
        </p>
        <p>
          Administrators can see file metadata, sharing state, activity and security condition, but not
          file contents by default. To read content, an administrator must explain why and request one
          specific file version. You can approve or deny that request. Approval permits one download,
          which is recorded in the administrator audit log and shown in your security notices.
        </p>
      </>
    ),
  },
  {
    id: 'sent',
    title: 'What leaves the server',
    content: (
      <ul>
        <li>
          <strong className="text-fg">AI provider:</strong> when a member uses the assistant or an administrator
          uses Shield AI, their question and the records the assistant looks up are sent to the configured
          language-model provider (Google Gemini or OpenAI, depending on the deployment). A member&apos;s tools
          can return only their own account, file, share and activity metadata; administrator tools can also
          return security records. File contents are never sent.
        </li>
        <li>
          <strong className="text-fg">Anomaly service:</strong> numeric activity measurements (rates, counts,
          entropy changes) and your account identifier are sent to ShieldShare&apos;s own anomaly-detection
          service, which runs alongside the server.
        </li>
        <li>No analytics, advertising or tracking services are used.</li>
      </ul>
    ),
  },
  {
    id: 'browser',
    title: 'Your browser',
    content: (
      <p>
        ShieldShare keeps your sign-in token in your browser&apos;s local storage so you stay signed in across
        tabs. It sets no cookies. Signing out removes the token and ends the session on the server.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'How long data is kept',
    content: (
      <>
        <p>
          Session records are removed 30 days after they expire. Everything else is kept until the people
          running the deployment delete it: deleted files keep their versions so they can be recovered,
          and security and audit records are kept as history.
        </p>
        <p>
          The controlled demo account is different: resetting the simulator deletes that account&apos;s
          files, versions and share links, and keeps its activity and security history.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Questions and deletion requests',
    content: (
      <p>
        Contact the people running this ShieldShare deployment. As a hackathon project it has no data
        protection officer and no formal process for access or deletion requests.
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="25 September 2026"
      intro="This page describes what this ShieldShare deployment stores about you, what it sends elsewhere, and who can see it."
      sections={SECTIONS}
    />
  );
}
