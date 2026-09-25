import { RiskBreakdown } from '../components/security/RiskBreakdown.jsx';
import { RiskScore } from '../components/security/RiskScore.jsx';
import { Badge, PermissionBadge, ShareStatusBadge, VersionStatusBadge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import {
  activityExample, assistantExample, detectionStages, heroFlow, recoveryFlow,
  riskExample, shareExample, versionExample,
} from './landing/exampleData.js';

function ExampleLabel() {
  return <Badge tone="info" className="uppercase tracking-[0.12em]">Example</Badge>;
}

function Connector({ vertical = false }) {
  return (
    <div aria-hidden="true" className={vertical ? 'flex h-8 justify-center' : 'hidden items-center lg:flex'}>
      <span className={vertical ? 'h-full border-l border-dashed border-accent/40' : 'w-10 border-t border-dashed border-accent/40'} />
      {!vertical && <Icon name="chevronRight" className="-ml-1 size-4 text-accent/60" />}
    </div>
  );
}

function FlowCards({ items, compact = false }) {
  return (
    <ol className={compact ? 'flex flex-col' : 'grid items-stretch lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]'}>
      {items.map((item, index) => (
        <li key={item.title} className="contents">
          <article className="landing-flow-card rounded-card border border-line-subtle bg-surface p-4 shadow-card">
            <span className="flex size-9 items-center justify-center rounded-control bg-accent/10 text-accent"><Icon name={item.icon} className="size-4" /></span>
            <h3 className="mt-3 text-heading font-semibold text-fg">{item.title}</h3>
            <p className="mt-1 text-meta text-fg-muted">{item.detail}</p>
          </article>
          {index < items.length - 1 && <><Connector /><div className="lg:hidden"><Connector vertical /></div></>}
        </li>
      ))}
    </ol>
  );
}

function SectionHeading({ id, eyebrow, title, description, align = 'left' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'}>
      <p className="text-meta font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
      <h2 id={id} className="mt-2 font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-fg sm:text-[2.25rem]">{title}</h2>
      {description && <p className="mt-4 text-body text-fg-secondary sm:text-[0.98rem] sm:leading-6">{description}</p>}
    </div>
  );
}

function HeroExample() {
  return (
    <div className="rounded-dialog border border-line bg-bg-secondary p-3 shadow-raised sm:p-4">
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle pb-3">
        <div><p className="text-heading font-semibold text-fg">Protected file flow</p><p className="text-meta text-fg-muted">One file, from upload to monitoring</p></div>
        <ExampleLabel />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_13rem]">
        <FlowCards items={heroFlow} compact />
        <aside aria-label="Example live activity" className="rounded-card border border-line-subtle bg-surface p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="text-heading font-semibold text-fg">Live activity</h3><Badge tone="success" dot>Connected</Badge></div>
          <p className="mt-1 text-meta text-fg-muted">Example activity</p>
          <ol className="mt-4 space-y-4">
            {activityExample.map((item) => (
              <li key={item.time} className="landing-activity-row grid grid-cols-[auto_1fr] gap-3">
                <span className="mt-1.5 size-2 rounded-full bg-accent" aria-hidden="true" />
                <div><p className="text-meta font-medium text-fg">{item.label}</p><p className="mt-0.5 text-meta text-fg-muted">{item.detail}</p><time className="mt-1 block font-mono text-[0.67rem] text-fg-muted">{item.time}</time></div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function ShareExample() {
  return (
    <div className="rounded-card border border-line-subtle bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3"><ExampleLabel /><ShareStatusBadge status={shareExample.status} /></div>
      <div className="mt-5 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-control bg-accent/10 text-accent"><Icon name="fileText" className="size-5" /></span>
        <div className="min-w-0"><p className="truncate font-medium text-fg">{shareExample.fileName}</p><p className="text-meta text-fg-muted">Expiring secure link</p></div>
      </div>
      <dl className="mt-5 divide-y divide-line-subtle border-y border-line-subtle text-body">
        <div className="flex items-center justify-between gap-3 py-3"><dt className="text-fg-muted">Permission</dt><dd><PermissionBadge permission={shareExample.permission} /></dd></div>
        <div className="flex items-center justify-between gap-3 py-3"><dt className="text-fg-muted">Expires</dt><dd className="font-medium text-fg">{shareExample.expires}</dd></div>
        <div className="flex items-center justify-between gap-3 py-3"><dt className="text-fg-muted">Password</dt><dd className="text-right font-medium text-fg">Optional</dd></div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3 text-meta"><span className="text-fg-muted">{shareExample.password}</span><span className="font-medium text-critical">Revoke link</span></div>
    </div>
  );
}

function VersionExample() {
  return (
    <div className="rounded-card border border-line-subtle bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3"><h3 className="text-heading font-semibold text-fg">Version history</h3><ExampleLabel /></div>
      <ol className="mt-5">
        {versionExample.map((version, index) => (
          <li key={version.id} className="relative grid grid-cols-[2.5rem_1fr] gap-3 pb-5 last:pb-0">
            {index < versionExample.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-5 top-10 border-l border-dashed border-line" />}
            <span className="flex size-10 items-center justify-center rounded-full border border-accent/30 bg-accent/10 font-mono text-tech text-accent">v{version.versionNumber}</span>
            <div className="pt-0.5"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-fg">{version.label}</p><VersionStatusBadge status={version.securityStatus} /></div><p className="mt-1 text-meta text-fg-muted">{version.detail}</p></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DetectionStage({ stage }) {
  const toneClasses = {
    success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', critical: 'bg-critical/10 text-critical',
  };
  return (
    <article className="rounded-card border border-line-subtle bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3"><span className={`flex size-10 items-center justify-center rounded-control ${toneClasses[stage.tone]}`}><Icon name={stage.icon} className="size-5" /></span><Badge tone={stage.tone}>{stage.eyebrow}</Badge></div>
      <h3 className="mt-4 text-heading font-semibold text-fg">{stage.title}</h3>
      <ul className="mt-3 space-y-2">{stage.items.map((item) => <li key={item} className="flex items-start gap-2 text-body text-fg-secondary"><Icon name="check" className="mt-0.5 size-4 text-accent" />{item}</li>)}</ul>
    </article>
  );
}

function CompactRiskBreakdown() {
  return (
    <div className="space-y-2 md:hidden">
      {riskExample.signals.filter((signal) => signal.points > 0).map((signal) => (
        <div key={signal.key} className="flex items-center justify-between gap-3 border-b border-line-subtle py-2 text-body last:border-0"><span className="text-fg-secondary">{signal.label}</span><span className="font-mono text-tech font-medium text-fg">+{signal.points}</span></div>
      ))}
    </div>
  );
}

export default function Landing() {
  const { phase, user } = useAuth();
  const signedIn = phase === 'authenticated';
  const appPath = user?.role === 'admin' ? '/admin' : '/app';

  return (
    <div className="overflow-hidden">
      <section aria-labelledby="landing-title" className="relative border-b border-line-subtle">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-72 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-accent)_7%,transparent),transparent)]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,0.88fr)_minmax(34rem,1.12fr)] lg:items-center lg:py-20">
          <div>
            <Badge tone="accent" dot>Behavioral file protection</Badge>
            <h1 id="landing-title" className="mt-5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.04em] text-fg sm:text-[3.6rem]">Share files. Catch ransomware-like behavior before it spreads.</h1>
            <p className="mt-5 max-w-xl text-[1rem] leading-7 text-fg-secondary">ShieldShare combines behavior rules, SHA-256 integrity, entropy changes, canary files and an Isolation Forest anomaly signal into an explainable risk score.</p>
            <div className="mt-7 flex flex-wrap gap-3"><Button variant="primary" to={signedIn ? appPath : '/register'}>{signedIn ? 'Open ShieldShare' : 'Get started'}</Button><Button variant="secondary" to="#how-it-works">See how it works</Button></div>
            <p className="mt-4 max-w-lg text-meta text-fg-muted">Detection uses several signals together. One signal alone is never treated as proof.</p>
          </div>
          <HeroExample />
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-b border-line-subtle py-16 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6"><SectionHeading id="how-title" eyebrow="How it works" title="A protected path from upload to recovery" description="Each step is connected to the same file history, activity log and security evidence." align="center" /><div className="mb-4 mt-10 flex justify-end"><ExampleLabel /></div><FlowCards items={heroFlow} /></div>
      </section>

      <section id="security" aria-labelledby="sharing-title" className="scroll-mt-20 bg-bg-secondary py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div><SectionHeading id="sharing-title" eyebrow="Secure sharing" title="Control how long a link works" description="Create a link with View or View & download permission, set an expiry, add an optional password, and revoke it when access should end." /><div className="mt-6 flex flex-wrap gap-2"><Badge tone="neutral">View</Badge><Badge tone="neutral">View & download</Badge><Badge tone="neutral">Expiry required</Badge><Badge tone="neutral">Optional password</Badge></div></div>
          <ShareExample />
        </div>
      </section>

      <section aria-labelledby="integrity-title" className="py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
          <VersionExample />
          <div><SectionHeading id="integrity-title" eyebrow="Integrity on every version" title="Each content change gets a new fingerprint" description="ShieldShare records a SHA-256 hash and entropy value for every stored version. Verification reads the stored bytes again and compares the result with the recorded hash." /><div className="mt-6 rounded-card border border-line-subtle bg-surface p-4 font-mono text-tech text-fg-secondary"><span className="text-fg-muted">SHA-256</span><br /><span className="break-all text-fg">8e71c5f2b67a…b42d</span></div></div>
        </div>
      </section>

      <section id="detection" aria-labelledby="detection-title" className="scroll-mt-20 border-y border-line-subtle bg-bg-secondary py-16 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <SectionHeading id="detection-title" eyebrow="Ransomware-like behavior detection" title="The pattern matters more than any single event" description="ShieldShare scores recent file activity inside each write request. When independent signal categories align at Critical, containment begins before the next write." align="center" />
          <div className="mb-4 mt-10 flex justify-end"><ExampleLabel /></div><div className="grid gap-0 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">{detectionStages.map((stage, index) => <div key={stage.title} className="contents"><DetectionStage stage={stage} />{index < detectionStages.length - 1 && <><Connector /><div className="lg:hidden"><Connector vertical /></div></>}</div>)}</div>
          <div className="mt-8 grid gap-6 rounded-dialog border border-line bg-surface p-5 shadow-card lg:grid-cols-[18rem_minmax(0,1fr)] lg:p-7">
            <div><div className="flex items-center justify-between gap-3"><h3 className="text-heading font-semibold text-fg">Example risk breakdown</h3><ExampleLabel /></div><div className="mt-5"><RiskScore evaluation={riskExample} /></div><p className="mt-4 text-meta text-fg-muted">Illustrative values using the implemented default signal weights.</p></div>
            <div className="min-w-0"><CompactRiskBreakdown /><div className="hidden md:block"><RiskBreakdown evaluation={riskExample} /></div></div>
          </div>
        </div>
      </section>

      <section id="recovery" aria-labelledby="recovery-title" className="scroll-mt-20 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6"><SectionHeading id="recovery-title" eyebrow="Recovery" title="Return to the last safe version, with proof" description="Suspicious versions stay in history. Recovery creates a new version from the last safe copy, verifies its SHA-256, restores the saved name and makes the file active again." align="center" /><div className="mt-10"><div className="mb-4 flex justify-end"><ExampleLabel /></div><FlowCards items={recoveryFlow} /></div></div>
      </section>

      <section aria-labelledby="ai-title" className="border-y border-line-subtle bg-bg-secondary py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div><SectionHeading id="ai-title" eyebrow="Shield AI" title="An admin copilot grounded in stored evidence" description="Shield AI explains incidents by calling controlled backend tools for risk, activity, file and version metadata. It does not detect ransomware-like activity and never receives file contents." /><p className="mt-5 text-body text-fg-secondary">Administrative actions are proposals only. The server rechecks authorization and executes an action only after an administrator confirms it.</p></div>
          <div className="rounded-dialog border border-line bg-surface p-5 shadow-card sm:p-6">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Icon name="assistant" className="size-5 text-accent" /><h3 className="text-heading font-semibold text-fg">Incident investigation</h3></div><ExampleLabel /></div>
            <div className="mt-5 rounded-card bg-bg-secondary p-4"><p className="text-meta font-medium text-fg-muted">Administrator</p><p className="mt-1 text-body text-fg">{assistantExample.question}</p></div>
            <div className="mt-3 rounded-card border border-line-subtle p-4"><p className="text-meta font-medium text-accent">Shield AI</p><p className="mt-2 text-body leading-6 text-fg-secondary">{assistantExample.answer}</p><div className="mt-4 flex flex-wrap gap-2">{assistantExample.sources.map((source) => <Badge key={source} tone="neutral"><Icon name="check" className="size-3" />{source}</Badge>)}</div></div>
            <div className="mt-4 flex items-start gap-3 rounded-control border border-warning/30 bg-warning/5 p-3"><Icon name="alertCircle" className="mt-0.5 size-4 text-warning" /><p className="text-meta text-fg-secondary">{assistantExample.action}</p></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6"><h2 id="cta-title" className="font-display text-[2rem] font-semibold tracking-tight text-fg">Share files with a recovery path already in place.</h2><p className="mt-4 text-body text-fg-secondary">Start a workspace, create a file version and see every important change in one activity trail.</p><div className="mt-7 flex justify-center gap-3">{signedIn ? <Button variant="primary" to={appPath}>Open ShieldShare</Button> : <><Button variant="primary" to="/register">Get started</Button><Button to="/login">Sign in</Button></>}</div></div>
      </section>
    </div>
  );
}
