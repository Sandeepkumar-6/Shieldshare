import { Badge } from '../ui/Badge.jsx';

// Severity (spec §32): SAFE green, SUSPICIOUS yellow, HIGH orange, CRITICAL red, INFO blue.
// Always a text label, never colour alone.
const SEVERITY = {
  SAFE: { tone: 'success', label: 'Safe' },
  SUSPICIOUS: { tone: 'warning', label: 'Suspicious' },
  HIGH: { tone: 'danger', label: 'High' },
  CRITICAL: { tone: 'critical', label: 'Critical' },
  INFO: { tone: 'info', label: 'Info' },
};

export function SeverityBadge({ severity, className }) {
  const entry = SEVERITY[severity] ?? { tone: 'neutral', label: severity };
  return <Badge tone={entry.tone} dot className={className}>{entry.label}</Badge>;
}

export const SEVERITY_TONE = Object.fromEntries(Object.entries(SEVERITY).map(([key, value]) => [key, value.tone]));

// Incident lifecycle (spec §18)
const INCIDENT_STATUS = {
  OPEN: { tone: 'danger', label: 'Open' },
  CONTAINED: { tone: 'warning', label: 'Contained' },
  INVESTIGATING: { tone: 'info', label: 'Investigating' },
  RECOVERED: { tone: 'success', label: 'Recovered' },
  RESOLVED: { tone: 'neutral', label: 'Resolved' },
  FALSE_POSITIVE: { tone: 'neutral', label: 'False positive' },
};

export function IncidentStatusBadge({ status }) {
  const entry = INCIDENT_STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}

export const ACTIVE_INCIDENT_STATUSES = ['OPEN', 'CONTAINED', 'INVESTIGATING'];
