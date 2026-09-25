import { Link } from 'react-router';
import { LegalPage } from './LegalPage.jsx';

const SECTIONS = [
  {
    id: 'service',
    title: 'The service',
    content: (
      <p>
        ShieldShare is a file-sharing workspace built as a hackathon project to demonstrate behavioral
        ransomware detection, containment and recovery. It is provided as is, without any warranty,
        service level or guarantee that files will be available or recoverable. Keep your own copies of
        anything that matters.
      </p>
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    content: (
      <ul>
        <li>Give accurate account details and keep your password to yourself.</li>
        <li>You are responsible for what happens through your account, including the share links you create and who you send them to.</li>
        <li>Administrators can freeze accounts, quarantine files and release them. Automated detection can freeze your account while an administrator reviews suspicious activity; you keep read access while it is frozen.</li>
      </ul>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    content: (
      <ul>
        <li>Upload only files you have the right to store and share. Do not upload malware, illegal content or other people&apos;s personal data.</li>
        <li>Do not try to access other users&apos; files, bypass security controls, or test attacks against accounts that are not yours.</li>
        <li>The ransomware simulator is a controlled demonstration. It runs only as the designated demo account, only when the deployment enables it, and only on its demo files.</li>
      </ul>
    ),
  },
  {
    id: 'monitoring',
    title: 'Monitoring',
    content: (
      <p>
        Using ShieldShare means your file activity is recorded and scored for security, and administrators
        can review it. The <Link to="/privacy" className="text-accent hover:text-accent-hover">privacy policy</Link> describes
        exactly what is stored and who can see it.
      </p>
    ),
  },
  {
    id: 'content',
    title: 'Your files',
    content: (
      <p>
        You keep all rights to the files you upload. ShieldShare stores and processes them only to provide
        the service: versions, integrity checks, sharing, security analysis and recovery. File contents are
        never sent to the AI provider.
      </p>
    ),
  },
  {
    id: 'ending',
    title: 'Ending use and changes',
    content: (
      <p>
        The people running the deployment can suspend accounts, reset the demo workspace or shut the
        service down at any time. These terms can change; the date at the top shows the latest version.
      </p>
    ),
  },
];

export default function Terms() {
  return <LegalPage title="Terms of service" updated="25 September 2026" sections={SECTIONS} />;
}
