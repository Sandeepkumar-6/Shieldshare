// Response serializers. Every client-facing shape is an explicit whitelist, so internal
// fields (passwordHash, tokenVersion, storageKey, isCanary, storage paths) can never leak
// by accident, even if a query selects them.

const id = (value) => (value == null ? null : String(value));

// api-contract.md §2.1: { id, name, email, role, status, createdAt }
export function toUserDTO(user) {
  return {
    id: id(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export function toSessionDTO(session, currentSessionId) {
  return {
    id: id(session._id),
    status: session.status,
    ip: session.ip ?? null,
    userAgent: session.userAgent ?? null,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt ?? session.createdAt,
    expiresAt: session.expiresAt,
    current: id(session._id) === id(currentSessionId),
  };
}

export function toFolderDTO(folder) {
  return {
    id: id(folder._id),
    name: folder.name,
    isRoot: Boolean(folder.isRoot),
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

// api-contract.md §2.3. `shareCount` (links currently usable) is included when the caller
// computed it.
export function toFileDTO(file, { shareCount } = {}) {
  return {
    id: id(file._id),
    name: file.name,
    folderId: id(file.folderId),
    size: file.size,
    mimeType: file.mimeType ?? null,
    status: file.status,
    currentVersion: file.currentVersion,
    sha256: file.sha256,
    entropy: file.entropy ?? null,
    lastVerifiedAt: file.lastVerifiedAt ?? null,
    shareCount,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function toVersionDTO(version, currentVersionNumber) {
  return {
    id: id(version._id),
    fileId: id(version.fileId),
    versionNumber: version.versionNumber,
    nameAtVersion: version.nameAtVersion,
    size: version.size ?? null,
    sha256: version.sha256,
    entropy: version.entropy ?? null,
    source: version.source,
    restoredFromVersion: version.restoredFromVersion ?? null,
    securityStatus: version.securityStatus,
    createdBy: id(version.createdBy),
    createdAt: version.createdAt,
    isCurrent: currentVersionNumber != null && version.versionNumber === currentVersionNumber,
  };
}

// Metadata keys a user may see on their own activity. Anything else stays server-side.
const USER_METADATA_KEYS = [
  'fileName', 'versionNumber', 'restoredFromVersion', 'fromFolderId', 'toFolderId', 'userAgent', 'reason',
  'permission', 'expiresAt', 'recipientLabel', 'passwordProtected', 'accessType',
];

export function toActivityDTO(activity) {
  const metadata = {};
  for (const key of USER_METADATA_KEYS) {
    if (activity.metadata && activity.metadata[key] !== undefined) {
      metadata[key] = key.endsWith('FolderId') ? id(activity.metadata[key]) : activity.metadata[key];
    }
  }
  return {
    id: id(activity._id),
    action: activity.action,
    timestamp: activity.timestamp,
    fileId: id(activity.fileId),
    directory: id(activity.directory),
    ip: activity.ip ?? null,
    hashBefore: activity.hashBefore ?? null,
    hashAfter: activity.hashAfter ?? null,
    entropyBefore: activity.entropyBefore ?? null,
    entropyAfter: activity.entropyAfter ?? null,
    sizeBefore: activity.sizeBefore ?? null,
    sizeAfter: activity.sizeAfter ?? null,
    nameBefore: activity.nameBefore ?? null,
    nameAfter: activity.nameAfter ?? null,
    metadata,
  };
}

// ── Sharing (api-contract §2.4) ─────────────────────────────────────────────────────────

// Status as the owner should read it: a link past its expiry is EXPIRED even while the
// stored status is still ACTIVE (or SUSPENDED, since it can never become usable again).
export function effectiveShareStatus(link, now = Date.now()) {
  if (link.status === 'REVOKED') return 'REVOKED';
  if (link.status === 'EXPIRED' || new Date(link.expiresAt).getTime() <= now) return 'EXPIRED';
  return link.status;
}

// Owner view. `link` must be loaded with +passwordHash so the flag can be computed; the
// hash itself is never serialized, and neither is tokenHash.
export function toShareDTO(link, file) {
  return {
    id: id(link._id),
    fileId: id(link.fileId),
    fileName: file?.name ?? null,
    fileStatus: file?.status ?? null,
    permission: link.permission,
    recipientLabel: link.recipientLabel ?? null,
    passwordProtected: Boolean(link.passwordHash),
    status: effectiveShareStatus(link),
    expiresAt: link.expiresAt,
    accessCount: link.accessCount ?? 0,
    lastAccessedAt: link.lastAccessedAt ?? null,
    revokedAt: link.revokedAt ?? null,
    createdAt: link.createdAt,
  };
}

// Public view for a share recipient. No ids, owner, paths or hashes.
export function toPublicShareDTO(link, file) {
  return {
    fileName: file.name,
    size: file.size,
    permission: link.permission,
    expiresAt: link.expiresAt,
    requiresPassword: Boolean(link.passwordHash),
  };
}

// ── Admin views (api-contract §2.6, §2.8, §2.9) ─────────────────────────────────────────

export function toAdminUserDTO(user, extras = {}) {
  return {
    id: id(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    securityStatus: user.securityStatus ?? 'SAFE',
    frozenAt: user.frozenAt ?? null,
    frozenReason: user.frozenReason ?? null,
    frozenByIncidentId: id(user.frozenByIncidentId),
    createdAt: user.createdAt,
    lastActivityAt: extras.lastActivityAt ?? null,
    openIncidents: extras.openIncidents ?? 0,
  };
}

export function toOwnerDTO(user) {
  return user ? { id: id(user._id), name: user.name, email: user.email } : null;
}

export function toAdminFileDTO(file, { owner, shareCount, accessRequest } = {}) {
  return {
    ...toFileDTO(file, { shareCount }),
    owner: toOwnerDTO(owner),
    // Administrators see canaries (spec §14); users never receive this field.
    isCanary: Boolean(file.isCanary),
    deletedAt: file.deletedAt ?? null,
    quarantinedAt: file.quarantinedAt ?? null,
    accessRequest: accessRequest ? {
      id: id(accessRequest._id),
      status: accessRequest.status,
      versionNumber: accessRequest.versionNumber,
      requestedAt: accessRequest.createdAt,
      respondedAt: accessRequest.respondedAt ?? null,
      usedAt: accessRequest.usedAt ?? null,
    } : null,
  };
}

export function toOwnerAccessRequestDTO(request, { file, admin } = {}) {
  return {
    id: id(request._id),
    file: file ? { id: id(file._id), name: file.name, status: file.status } : null,
    versionNumber: request.versionNumber,
    administrator: admin ? { name: admin.name } : null,
    reason: request.reason,
    status: request.status,
    requestedAt: request.createdAt,
    respondedAt: request.respondedAt ?? null,
    usedAt: request.usedAt ?? null,
  };
}

// Administrators see every event, including internal security events, with full metadata.
export function toAdminActivityDTO(activity) {
  return {
    ...toActivityDTO(activity),
    userId: id(activity.userId),
    sessionId: id(activity.sessionId),
    isCanary: Boolean(activity.isCanary),
    metadata: activity.metadata ?? {},
  };
}

export function toQuarantineDTO(item, { file, owner, admin, releasedBy, versions = [], suspendedLinks = 0 } = {}) {
  return {
    id: id(item._id),
    status: item.status,
    reason: item.reason,
    quarantinedBy: item.quarantinedBy,
    admin: toOwnerDTO(admin),
    incidentId: id(item.incidentId),
    file: file ? { id: id(file._id), name: file.name, status: file.status, currentVersion: file.currentVersion } : null,
    owner: toOwnerDTO(owner),
    versions: versions.map((version) => ({
      id: id(version._id),
      versionNumber: version.versionNumber,
      securityStatus: version.securityStatus,
    })),
    suspendedLinks,
    releasedAt: item.releasedAt ?? null,
    releasedBy: toOwnerDTO(releasedBy),
    releaseNote: item.releaseNote ?? null,
    createdAt: item.createdAt,
  };
}

export function toAuditDTO(entry, { admin, targetLabel } = {}) {
  return {
    id: id(entry._id),
    action: entry.action,
    admin: toOwnerDTO(admin),
    target: entry.target?.kind
      ? { kind: entry.target.kind, id: id(entry.target.id), label: targetLabel ?? null }
      : null,
    via: entry.via,
    result: entry.result,
    error: entry.error ?? null,
    note: entry.note ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    createdAt: entry.createdAt,
  };
}

// ── Detection, incidents, alerts (api-contract §2.7–2.9, §3.7–3.10) ─────────────────────

export function toEvaluationDTO(evaluation) {
  if (!evaluation) return null;
  return {
    id: id(evaluation._id),
    userId: id(evaluation.userId),
    incidentId: id(evaluation.incidentId),
    windowStart: evaluation.windowStart,
    windowEnd: evaluation.windowEnd,
    rawScore: evaluation.rawScore,
    score: evaluation.score,
    severity: evaluation.severity,
    categories: evaluation.categories ?? [],
    capApplied: Boolean(evaluation.capApplied),
    reasons: evaluation.reasons ?? [],
    signals: (evaluation.signals ?? []).map((signal) => ({
      key: signal.key,
      category: signal.category,
      label: signal.label,
      level: signal.level,
      observed: signal.observed ?? {},
      threshold: signal.threshold ?? {},
      points: signal.points,
      maxPoints: signal.maxPoints ?? null,
      evidence: (signal.evidence ?? []).map(id),
    })),
    ml: {
      status: evaluation.ml?.status ?? 'DISABLED',
      anomalyScore: evaluation.ml?.anomalyScore ?? null,
      isAnomaly: evaluation.ml?.isAnomaly ?? null,
      modelVersion: evaluation.ml?.modelVersion ?? null,
    },
    configVersion: evaluation.configVersion,
    phase: evaluation.phase,
    createdAt: evaluation.createdAt,
  };
}

// List row for /admin/incidents.
export function toIncidentSummaryDTO(incident, { user } = {}) {
  return {
    id: id(incident._id),
    incidentNumber: incident.incidentNumber,
    status: incident.status,
    severity: incident.severity,
    riskScore: incident.riskScore,
    trigger: incident.trigger ?? null,
    user: toOwnerDTO(user),
    affectedFileCount: incident.affectedFiles?.length ?? 0,
    canaryTriggered: Boolean(incident.canaryTriggered),
    freezeStatus: incident.freezeStatus,
    quarantineStatus: incident.quarantineStatus,
    windowStart: incident.windowStart,
    windowEnd: incident.windowEnd ?? null,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    resolvedAt: incident.resolvedAt ?? null,
  };
}

export function toIncidentDTO(incident, { user, files = [], folders = [], admins = new Map() } = {}) {
  const adminRef = (adminId) => (adminId ? toOwnerDTO(admins.get(String(adminId))) ?? { id: id(adminId) } : null);
  return {
    ...toIncidentSummaryDTO(incident, { user }),
    signals: incident.signals ?? [],
    affectedFiles: files.map((file) => ({ id: id(file._id), name: file.name, status: file.status, isCanary: Boolean(file.isCanary) })),
    affectedDirectories: folders.map((folder) => ({ id: id(folder._id), name: folder.name })),
    latestEvaluationId: id(incident.latestEvaluationId),
    peakEvaluationId: id(incident.peakEvaluationId),
    assignedTo: adminRef(incident.assignedTo),
    resolution: incident.resolution ?? null,
    resolutionNote: incident.resolutionNote ?? null,
    resolvedBy: adminRef(incident.resolvedBy),
    timeline: (incident.timeline ?? []).map((entry) => ({
      at: entry.at,
      type: entry.type,
      text: entry.text,
      actor: entry.actor,
      admin: adminRef(entry.adminId),
      ref: entry.ref?.kind ? { kind: entry.ref.kind, id: id(entry.ref.id) } : null,
    })),
  };
}

export function toAlertDTO(alert, { incident, user, acknowledgedBy } = {}) {
  return {
    id: id(alert._id),
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    status: alert.status,
    incident: incident ? { id: id(incident._id), incidentNumber: incident.incidentNumber, status: incident.status } : null,
    user: toOwnerDTO(user),
    acknowledgedBy: toOwnerDTO(acknowledgedBy),
    acknowledgedAt: alert.acknowledgedAt ?? null,
    createdAt: alert.createdAt,
  };
}

export function toVersionSummaryDTO(version) {
  if (!version) return null;
  return {
    id: id(version._id),
    versionNumber: version.versionNumber,
    nameAtVersion: version.nameAtVersion,
    size: version.size ?? null,
    sha256: version.sha256,
    entropy: version.entropy ?? null,
    source: version.source,
    restoredFromVersion: version.restoredFromVersion ?? null,
    securityStatus: version.securityStatus,
    createdAt: version.createdAt,
  };
}

// One affected file in an incident, with where its recovery stands.
export function toRecoveryFileDTO(state) {
  return {
    file: {
      id: id(state.file._id),
      name: state.file.name,
      status: state.file.status,
      currentVersion: state.file.currentVersion,
      folderId: id(state.file.folderId),
    },
    state: state.state,
    windowVersions: state.windowVersions.map(toVersionSummaryDTO),
    proposedSafeVersion: toVersionSummaryDTO(state.proposed),
    restoredVersion: toVersionSummaryDTO(state.restored),
    quarantine: state.quarantineItem
      ? { id: id(state.quarantineItem._id), status: state.quarantineItem.status, previousFileStatus: state.quarantineItem.previousFileStatus ?? 'ACTIVE' }
      : null,
  };
}
