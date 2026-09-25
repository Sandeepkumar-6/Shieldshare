export const heroFlow = [
  { icon: 'upload', title: 'Upload', detail: 'budget-plan.csv' },
  { icon: 'fingerprint', title: 'Integrity recorded', detail: 'SHA-256 + version 1' },
  { icon: 'link', title: 'Secure link', detail: 'View & download · 7 days' },
  { icon: 'shieldCheck', title: 'Monitored', detail: 'Activity enters the risk window' },
];

export const activityExample = [
  { time: '10:42:18', label: 'File uploaded', detail: 'budget-plan.csv' },
  { time: '10:42:19', label: 'Version created', detail: 'v1 · SHA-256 recorded' },
  { time: '10:43:02', label: 'Share link created', detail: 'Download · expires in 7 days' },
];

export const shareExample = {
  fileName: 'quarterly-plan.pdf', permission: 'DOWNLOAD', expires: '7 days',
  password: 'Optional password enabled', status: 'ACTIVE',
};

export const versionExample = [
  { id: 'version-1', versionNumber: 1, label: 'Uploaded', detail: 'SHA-256 recorded', securityStatus: 'SAFE' },
  { id: 'version-2', versionNumber: 2, label: 'Content updated', detail: 'New SHA-256 recorded', securityStatus: 'SAFE' },
  { id: 'version-3', versionNumber: 3, label: 'Current version', detail: 'Integrity verified', securityStatus: 'SAFE' },
];

export const detectionStages = [
  { eyebrow: 'Normal activity', title: 'A few expected changes', tone: 'success', icon: 'fileText', items: ['One file updated', 'One folder affected', 'Human-paced activity'] },
  { eyebrow: 'Suspicious pattern', title: 'Several signals align', tone: 'warning', icon: 'activity', items: ['Mass modification', 'Mass rename and extension changes', 'Canary file touched'] },
  { eyebrow: 'ShieldShare response', title: 'Critical activity contained', tone: 'critical', icon: 'shield', items: ['Account frozen to read-only', 'Affected files quarantined', 'Administrator alerted'] },
];

export const riskExample = {
  id: 'example-evaluation', score: 90, rawScore: 90, severity: 'CRITICAL',
  categories: ['BEHAVIOR', 'INTEGRITY', 'CONTENT', 'DECEPTION'], capApplied: false,
  configVersion: 2, phase: 'INLINE', reasons: [],
  ml: { status: 'OK', anomalyScore: 0.82, modelVersion: 'synthetic-baseline' },
  signals: [
    { key: 'rapidActivity', category: 'BEHAVIOR', label: 'Rapid activity', level: 'partial', observed: { operations: 18 }, threshold: { operations: 30 }, points: 7.5, maxPoints: 15 },
    { key: 'massModification', category: 'BEHAVIOR', label: 'Mass modification', level: 'full', observed: { files: 11 }, threshold: { files: 10 }, points: 20, maxPoints: 20 },
    { key: 'massRename', category: 'BEHAVIOR', label: 'Mass rename', level: 'partial', observed: { files: 5 }, threshold: { files: 8 }, points: 7.5, maxPoints: 15 },
    { key: 'directorySpread', category: 'BEHAVIOR', label: 'Directory spread', level: 'full', observed: { folders: 3 }, threshold: { folders: 3 }, points: 10, maxPoints: 10 },
    { key: 'extensionChanges', category: 'BEHAVIOR', label: 'Extension changes', level: 'full', observed: { files: 6, sameExtension: 6, extension: '.locked' }, threshold: { files: 5, sameExtension: 3 }, points: 15, maxPoints: 15 },
    { key: 'hashChangeRatio', category: 'INTEGRITY', label: 'SHA-256 change ratio', level: 'full', observed: { changedFiles: 10, touchedFiles: 11, ratio: 0.91 }, threshold: { gateMet: true }, points: 10, maxPoints: 10 },
    { key: 'entropyChange', category: 'CONTENT', label: 'Entropy increase', level: 'none', observed: { enabled: true, qualifyingFiles: 0, modifiedFiles: 11, ratio: 0, files: [] }, threshold: { baselineMax: 6, deltaMin: 1.5 }, points: 0, maxPoints: 10 },
    { key: 'canaryTrigger', category: 'DECEPTION', label: 'Canary trigger', level: 'full', observed: { canaryFiles: 1 }, threshold: { any: true }, points: 20, maxPoints: 20 },
    { key: 'mlAnomaly', category: 'ANOMALY', label: 'ML anomaly', level: 'none', observed: {}, threshold: {}, points: 0, maxPoints: 10 },
  ],
};

export const recoveryFlow = [
  { icon: 'history', title: 'Last safe version', detail: 'Select the version from before the incident' },
  { icon: 'fingerprint', title: 'SHA-256 verified', detail: 'Stored bytes must match the safe version' },
  { icon: 'fileText', title: 'Original name back', detail: 'The saved name returns with the content' },
  { icon: 'checkCircle', title: 'Recovery complete', detail: 'The restored file becomes active' },
];

export const assistantExample = {
  question: 'Why was this account frozen?',
  answer: 'The stored evaluation reached Critical after behavior, integrity and canary signals aligned. The incident shows 11 modified files across 3 folders and one canary trigger.',
  sources: ['Incident details', 'Risk breakdown', 'Affected files'],
  action: 'Any proposed freeze, unfreeze, quarantine or restore waits for administrator confirmation.',
};
