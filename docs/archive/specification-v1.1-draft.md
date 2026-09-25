# ShieldShare — Product & Technical Specification

**Version:** 1.1  
**Project:** ShieldShare  
**Type:** Hackathon-ready secure file-sharing platform  
**Architecture:** MERN + optional Python ML service + LLM-based Security Assistant  
**Companion document:** `api-contract.md` (REST API, Mongoose schemas, Socket.IO payloads, Shield AI tools)

---

## Changelog — v1.0 → v1.1

v1.1 closes gaps found during architecture review. Original requirements and terminology are preserved; additions are marked **(v1.1)** in the relevant sections.

| # | Area | Change | Section |
|---|------|--------|---------|
| 1 | Simulator | Simulator acts as an authenticated API client, not a direct filesystem writer, so its activity enters the real pipeline | §30 |
| 2 | Files | Added content-modification operation (new version upload) | §6 |
| 3 | Files | Delete is a soft delete; version blobs are retained | §6 |
| 4 | Detection | Rule evaluation runs inline on write requests; ML runs async with timeout | §10 |
| 5 | Auth | Added sessions, token revocation and per-request freeze enforcement | §5 |
| 6 | Files | Added folders so directory-spread can be measured | §6 |
| 7 | Canary | Canary files are seeded per user workspace and flagged `isCanary` | §14 |
| 8 | Integrity | Hash signal is scored as a hash-change ratio within a window | §12 |
| 9 | Entropy | Entropy delta weighted by baseline; sampling for large files | §13 |
| 10 | Risk | Clamp, per-window scoring, multi-category gate, incident de-duplication, stored evaluations | §16 |
| 11 | Recovery | "Last known safe version" defined; restore brings back name; restore creates a new version; integrity verification defined | §8, §17 |
| 12 | ML | Score normalization, fallback, honest evaluation wording | §15 |
| 13 | Shield AI | Identity pass-through, pending-action confirmation, prompt-injection handling, citation rules | §23 |
| 14 | Incidents | Incident lifecycle including FALSE_POSITIVE | §18 |
| 15 | Quarantine | Side effects on download and share links defined | §17 |
| 16 | UX | Frozen-user experience defined | §25 |
| 17 | Data | Alert references incident; added Session, RiskEvaluation, DetectionConfig, AdminAuditLog, Folder | §26 |
| 18 | Sharing | Sharing model resolved as link-based with optional recipient label | §7 |
| 19 | Frontend | Page list reconciled with `frontend/skill.md` routes | §28 |

---

## 1. Product Overview

ShieldShare is a secure file-sharing platform that monitors file activity, detects ransomware-like behavior, calculates an explainable risk score, automatically contains critical activity, preserves safe file versions, and assists administrators through an AI Security Assistant.

Core flow:

**Monitor → Detect → Explain → Contain → Recover → Investigate**

The product has two primary experiences:

1. **User/File-sharing experience**
   - Authentication
   - File upload/download
   - File management
   - Secure sharing
   - Expiring links
   - Version history
   - Personal security status

2. **Administrator/Security experience**
   - Security dashboard
   - Activity monitoring
   - Risk detection
   - Incidents
   - Quarantine
   - Recovery
   - Real-time alerts
   - Shield AI Security Assistant

---

# 2. Goals

## Primary Goals

- Provide secure file sharing with role-based access.
- Monitor file activity continuously.
- Detect ransomware-like behavioral patterns.
- Combine multiple security signals instead of relying on one detector.
- Provide an explainable 0–100 risk score.
- Automatically freeze and quarantine critical activity.
- Preserve and restore safe file versions.
- Provide real-time security visibility.
- Provide an AI assistant for investigation and explanation.

## Non-Goals

The MVP does not require:

- OCR
- Facial recognition
- Computer vision
- Blockchain
- Cryptocurrency
- Generic chatbot functionality
- EDR integration
- Hardware-backed attestation
- Enterprise-scale immutable/WORM storage
- Advanced deep-learning ransomware classification

These may be future enhancements only.

---

# 3. Technology Stack

## Frontend

- React
- Vite
- Tailwind CSS
- React Router
- Axios
- Recharts
- Socket.IO Client

## Backend

- Node.js
- Express.js
- JWT
- bcrypt/bcryptjs
- Multer
- Socket.IO
- Rate limiting
- Security middleware
- Input validation

## Database

- MongoDB
- Mongoose

## Security Detection

- SHA-256
- Behavioral rule engine
- Canary/decoy files
- Entropy analysis
- Explainable risk engine

## Machine Learning

Optional/advanced MVP component:

- Python
- FastAPI
- scikit-learn
- pandas
- joblib
- Isolation Forest

ML detects anomalous activity. It must not independently claim that an event is ransomware.

## AI Assistant

- LLM API
- Tool/function calling
- Backend authorization layer

---

# 4. User Roles

## 4.1 User

Permissions:

- Register
- Login/logout
- Upload files
- Download files
- View files
- Rename files
- Delete files
- Share files
- Create expiring links
- View versions
- View personal activity
- View security status

## 4.2 Administrator

Additional permissions:

- View users
- View files
- View system activity
- View security alerts
- View incidents
- View risk scores
- Investigate suspicious activity
- Freeze users/sessions
- Unfreeze users/sessions
- View quarantined files
- Restore safe versions
- View security analytics
- Use Shield AI

All sensitive permissions must be enforced server-side.

---

# 5. Authentication & Authorization

## Requirements

- Registration
- Login
- Password hashing
- JWT authentication
- Protected routes
- Role-based access control
- Admin-only API endpoints
- Logout
- Session security status

## Security Rules

- Never trust a role supplied by the frontend.
- Verify authorization on every sensitive endpoint.
- Never store plaintext passwords.
- Store secrets in environment variables.
- Never commit `.env` files.

## Sessions and Token Revocation (v1.1)

JWTs are stateless, so freeze and logout need server-side state.

- Every login creates a `Session` record (`sessionId`, user, IP, user agent, `lastSeenAt`, `status`).
- The access token carries `sub` (user ID), `sid` (session ID) and `tv` (the user's `tokenVersion`).
- The `authenticate` middleware verifies the signature **and** checks that the session is `ACTIVE` and `tv` matches the user's current `tokenVersion`.
- Logout sets the session to `REVOKED`.
- Short-lived access tokens (for example 15 minutes) are recommended. Refresh tokens are optional for the MVP.

## Freeze Enforcement (v1.1)

- Freezing a user sets `user.status = FROZEN`. For the MVP, the user stays logged in with read-only access.
- An optional "freeze and sign out" also increments `tokenVersion` and revokes all of that user's sessions.
- A `requireNotFrozen` middleware runs on **every write endpoint** (upload, modify, rename, move, delete, share, revoke share).
- A frozen user may still log in, view files and see their security notice. They may not modify, delete, rename, share, or download quarantined files.
- The role is always read from the database record, never from the token payload alone.

---

# 6. File Management

## Upload Flow

```text
Select File
    ↓
Validate File
    ↓
Calculate SHA-256
    ↓
Calculate Entropy
    ↓
Store File
    ↓
Create File Record
    ↓
Create Version 1
    ↓
Create Activity Event
```

## Validation

Validate:

- File size
- MIME type
- Extension
- Filename
- Path traversal attempts
- Storage destination
- Upload permissions

## Supported Actions

- Upload
- Download
- View metadata
- Rename
- Delete
- Share
- View versions
- Restore version
- **Modify content (v1.1)**: upload new content for an existing file
- **Move to folder (v1.1)**

Every important operation must generate an activity event.

## Modify Content Flow (v1.1)

`PUT /api/files/:id/content` replaces a file's content and is the source of MODIFY events.

```text
Receive new content
    ↓
Validate (size, MIME, permissions, not frozen, file not quarantined)
    ↓
Calculate SHA-256
    ↓
Calculate entropy
    ↓
Store as new blob (never overwrite a previous version's blob)
    ↓
Create Version N+1
    ↓
Update File.currentVersion, sha256, entropy
    ↓
Create MODIFY activity (hashBefore/After, entropyBefore/After, sizeBefore/After)
    ↓
Inline detection evaluation (§10)
```

## Folders (v1.1)

Directory-spread detection needs a directory concept.

- Each file belongs to one folder (`folderId`). The default is the user's root folder.
- Folders are logical (database records), not real server paths.
- `Activity.directory` stores the folder ID of the affected file.
- Nested folders are optional. A single level is enough for the MVP.

## Soft Delete (v1.1)

Deletion must never destroy evidence or recovery points.

- `DELETE /api/files/:id` sets `File.status = DELETED` and `deletedAt`.
- Version blobs are retained.
- Deleted files are hidden from normal listings but remain visible to administrators and restorable during recovery.
- Permanent purge is out of scope for the MVP.

## Name History (v1.1)

Every version stores the file name (`nameAtVersion`) at the time it was created. A RENAME activity stores `nameBefore` and `nameAfter`. Recovery restores the name as well as the content (for example `report.pdf.locked` → `report.pdf`).

---

# 7. Secure Sharing

## Share Link

Each share link should contain:

- File ID
- Creator
- Permission
- Secure token
- Expiration
- Status
- Creation timestamp

## Permissions

Minimum:

- View
- Download

Optional:

- Password-protected link

## Requirements

- Tokens must be unpredictable.
- Expired links must stop working.
- Revoked links must stop working.
- Internal storage paths must never be exposed.
- **(v1.1)** Only the SHA-256 hash of the token is stored (`tokenHash`). The raw token is shown once, at creation.
- **(v1.1)** Links to a quarantined or deleted file are automatically `SUSPENDED` and stop working. Recovery can reactivate them; see §17.

## Sharing Model Decision (v1.1)

`frontend/skill.md` shows "Shared with user@example.com", but this spec defines link-based sharing. Resolution:

- Sharing remains **link-based** (source of truth: this spec).
- A share link may carry an optional `recipientLabel` (for example an email address) for display only.
- The label is **not** an access control. Anyone holding the link and, if set, the password can use it.
- Account-to-account sharing is future scope.

---

# 8. File Versioning

Every meaningful modification creates a new version.

Example:

```text
Financial_Report.pdf

V1  SAFE
V2  SAFE
V3  SAFE
V4  SUSPICIOUS
```

## Version Fields

- File ID
- Version number
- Storage path/reference
- SHA-256
- Entropy
- Created by
- Created timestamp
- Security status
- **(v1.1)** Name at version (`nameAtVersion`)
- **(v1.1)** Size
- **(v1.1)** Source: `UPLOAD`, `MODIFY` or `RESTORE`; a restored version also records `restoredFromVersion`

Safe versions must remain available for recovery.

## Version Security Status (v1.1)

```text
SAFE         Created outside any incident window
SUSPICIOUS   Created inside an incident's activity window
QUARANTINED  Suspicious version that has been contained
RESTORED     New version created by recovery from a SAFE version
```

**Retroactive marking:** detection fires *after* the first malicious writes. When an incident opens, every version created by the incident user after the incident's `windowStart` is re-marked `SUSPICIOUS`, even if it was created as `SAFE`.

**Last known safe version:** for a file in an incident, the version with the highest `versionNumber` whose `createdAt < incident.windowStart` and whose status is `SAFE` or `RESTORED`.

---

# 9. Activity Monitoring

Create a centralized activity logging system.

## Events

- LOGIN
- LOGOUT
- UPLOAD
- DOWNLOAD
- MODIFY
- RENAME
- DELETE
- SHARE
- RESTORE
- QUARANTINE
- FREEZE
- UNFREEZE
- **(v1.1)** MOVE
- **(v1.1)** SHARE_REVOKE
- **(v1.1)** SHARE_ACCESS (a download or view through a share link)
- **(v1.1)** CANARY_TRIGGER
- **(v1.1)** INTEGRITY_CHANGE (emitted with MODIFY when the hash differs)
- **(v1.1)** QUARANTINE_RELEASE

## Activity Metadata

Where applicable:

- User ID
- File ID
- Action
- Timestamp
- IP address
- Directory
- File size before/after
- Previous hash
- New hash
- Previous entropy
- New entropy
- Additional event metadata

The activity stream is the main source for behavioral detection.

---

# 10. Ransomware Detection Engine

ShieldShare uses a hybrid detection architecture.

```text
Activity
   ↓
Feature Extraction
   ↓
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Rules        │ SHA-256      │ Entropy      │ Canary       │
└──────────────┴──────────────┴──────────────┴──────────────┘
                         ↓
                  Isolation Forest
                         ↓
                    Risk Engine
```

## Evaluation Timing (v1.1)

If detection runs only after requests finish, a fast attacker completes every operation before the freeze lands. Detection is therefore split:

```text
Write request (modify / rename / delete / move)
    ↓
Persist + create Activity
    ↓
INLINE (synchronous, same request):
    update per-user sliding-window counters
    evaluate rules + integrity + entropy + canary
    compute deterministic risk
    if CRITICAL → freeze + open/update incident before responding
    ↓
Respond (a frozen user's next write gets 423 Locked)
    ↓
ASYNC (not blocking the request):
    call ML service (timeout, default 1500 ms)
    re-evaluate risk including ML contribution
    emit risk.updated
```

- Sliding-window counters are kept in memory per user. The default window is 60 seconds and is configurable. They are rebuilt from the Activity collection on server restart.
- The deterministic path (rules, integrity, entropy, canary) must be able to reach CRITICAL on its own. ML can raise a score but is never required for containment.
- Evaluation runs per **user** and per **window**, not per individual file.

## Signal Categories (v1.1)

Signals are grouped into independent categories for the multi-signal gate in §16:

```text
BEHAVIOR   rapid activity, mass modification, mass rename, mass delete, directory spread, extension changes
INTEGRITY  hash-change ratio
CONTENT    entropy change
DECEPTION  canary trigger
ANOMALY    ML anomaly
```

---

# 11. Behavioral Rule Engine

Detect the following patterns.

## 11.1 Rapid Activity

High operation frequency within a short time window.

Example:

```text
Normal:
5–15 operations/hour

Suspicious:
100 operations within seconds
```

Thresholds must be configurable.

## 11.2 Mass Modification

Detect unusually many files modified within a short time window.

## 11.3 Mass Rename

Detect rapid renaming of many files.

## 11.4 Mass Delete

Detect rapid deletion of many files.

## 11.5 Directory Spread

Detect activity affecting unusually many directories.

## 11.6 Extension Changes

Detect sudden changes to file extensions across many files.

## 11.7 Unusual User Activity

Compare current activity against a user's normal activity profile where sufficient history exists.

Important:

Behavioral anomalies are signals, not proof of ransomware.

## Default Rule Thresholds (v1.1)

All values are stored in `DetectionConfig` and editable by administrators. The defaults are tuned so the controlled simulator clearly exceeds them while a person working manually in the UI does not. They are **not** empirically validated against real ransomware.

| Rule | Default trigger (per 60 s window) | Purpose |
|------|-----------------------------------|---------|
| Rapid activity | ≥ 30 write operations | A human in a web UI rarely exceeds a few writes per minute |
| Mass modification | ≥ 10 distinct files modified | Encryption touches many files in sequence |
| Mass rename | ≥ 8 distinct files renamed | Ransomware commonly renames encrypted files |
| Mass delete | ≥ 8 distinct files deleted | Covers "encrypt copy, delete original" variants |
| Directory spread | ≥ 3 distinct folders written | Legitimate bulk edits usually stay in one folder |
| Extension changes | ≥ 5 renames that change the extension, or ≥ 3 to the same new extension | Catches `.locked`, `.enc`, `.crypt` patterns |

Rules fire at two levels: `partial` (≥ 50% of threshold) contributes half weight; `full` (≥ threshold) contributes full weight. This avoids a cliff at exactly one operation.

**Unusual user activity (§11.7)** is evaluated only when the user has at least 7 days of activity history. Otherwise it contributes 0 and records "insufficient history". This is Priority 2.

---

# 12. SHA-256 Integrity Detection

Each stored file version receives a SHA-256 fingerprint.

When modified:

```text
Previous Hash
      ↓
New Hash
      ↓
Compare
```

If the hashes differ:

- Record an integrity-change event.
- Store the new hash.
- Add the signal to the risk engine.

A SHA-256 change alone must never automatically classify an operation as ransomware.

## Hash-Change Ratio (v1.1)

Every legitimate modification changes the hash, so a single hash change carries almost no information. The risk engine scores the **hash-change ratio** instead:

```text
hashChangeRatio = files with a changed hash in the window
                  ÷ files owned by the user that were touched in the window
```

It contributes only when at least the mass-modification `partial` threshold is also met. A user editing one document repeatedly produces a high ratio on a tiny sample and must not score.

## Integrity Verification (v1.1)

Integrity verification means: read the stored bytes, recompute SHA-256, and compare with the stored hash of that version. It is performed:

- on every restore (§17), before the restore is marked complete
- on demand from the File Details Integrity tab (`POST /api/files/:id/verify`)

The UI may show "SHA-256 verified" only after a verification that passed, with its timestamp.

---

# 13. Entropy Analysis

Implement Shannon entropy analysis as a supporting signal.

For each applicable file version:

- Calculate entropy.
- Store baseline entropy.
- Calculate new entropy after modification.
- Calculate entropy delta.

Use entropy changes as evidence.

Do not use:

```text
High entropy = ransomware
```

Instead combine entropy with behavioral and other security signals.

Note: advanced entropy analysis is an enhancement to the original MVP scope and should not destabilize the core product.

## Baseline-Aware Entropy (v1.1)

Compressed formats (PDF, DOCX, XLSX, PPTX, ZIP, JPG, PNG, MP4) already measure about 7.8–8.0 bits/byte. Encrypting them barely changes entropy, so a delta on those files is weak evidence.

- Entropy is measured in bits per byte (0–8).
- A file's entropy delta counts as a signal only when its **previous** entropy was below 6.0 **and** the delta is ≥ 1.5. Both values are configurable.
- The entropy signal is scored at window level: the share of modified files in the window that meet the rule.
- Files larger than 1 MB are sampled: first 64 KB, last 64 KB and 4 evenly spaced 64 KB blocks.
- The demo dataset must include low-entropy files (`.txt`, `.csv`, `.json`, `.md`) so the signal is observable. This is stated in the demo script, not hidden.

---

# 14. Canary File System

Create controlled decoy files under a protected ShieldShare location.

Example:

```text
.shieldshare/
└── canary/
    ├── canary_finance.xlsx
    ├── canary_document.docx
    └── canary_report.pdf
```

## Trigger

If suspicious activity:

- Modifies
- Renames
- Deletes

a canary file:

1. Create a canary-trigger event.
2. Increase risk.
3. Mark the event as high-confidence evidence.
4. Notify the detection engine.
5. Notify administrators when appropriate.

Canary files must not be the only ransomware detector.

---

# 15. Machine Learning Layer

## Model

Use **Isolation Forest** for anomaly detection.

## Input Features

Possible features:

- Operations per minute
- Modifications per minute
- Renames per minute
- Deletions per minute
- Directories affected
- Extension changes
- Entropy delta
- Hash-change ratio
- Operation velocity
- Time between operations

## Model Behavior

The model learns normal activity patterns and identifies anomalous activity.

Output:

- Anomaly score
- Anomaly classification

The model must not independently claim:

> "This is ransomware."

Instead:

> "This activity is anomalous."

The anomaly score is passed to the Risk Engine.

## Dataset

If no real dataset is available:

- Create a small synthetic activity dataset.
- Clearly identify it as simulated.
- Train primarily on normal behavioral patterns.
- Use controlled ransomware-like activity for demonstration.

Do not claim a production-grade accuracy percentage without a proper evaluation dataset.

---

# 16. Risk Engine

The Risk Engine combines all evidence.

## Signals

- Rapid activity
- Mass modification
- Mass rename
- Mass deletion
- Directory spread
- Extension changes
- SHA-256 change
- Entropy change
- Canary trigger
- ML anomaly

## Risk Score

Range:

```text
0–100
```

Default severity:

```text
0–29     SAFE
30–59    SUSPICIOUS
60–79    HIGH
80–100   CRITICAL
```

Thresholds must be configurable.

## Explainability

Every risk score must store contributing reasons.

Example:

```text
Risk Score: 94

+30 Mass modification
+20 Rapid activity
+15 Multiple directories
+20 Mass rename
+15 Canary trigger
```

The UI must show these reasons.

Do not display a risk number without evidence.

---

# 17. Automatic Response

When risk reaches CRITICAL:

```text
Risk >= 80
     ↓
CRITICAL
```

## Freeze

Temporarily stop risky file operations for the affected user/session.

## Quarantine

Move suspicious files into a controlled quarantine state.

Do not permanently delete suspicious evidence.

## Alert

Create a Security Incident and notify administrators.

## Recovery

Allow an administrator to restore the last known safe version.

---

# 18. Security Incident Model

Each incident should contain:

- Incident ID
- User
- Risk score
- Severity
- Trigger
- Reasons
- Affected files
- Affected directories
- Timeline
- ML anomaly information
- Integrity signals
- Entropy signals
- Canary status
- Freeze status
- Quarantine status
- Resolution
- Created timestamp
- Resolved timestamp

---

# 19. Real-Time Security Events

Use Socket.IO.

Events:

- security.alert
- risk.updated
- canary.triggered
- user.frozen
- file.quarantined
- recovery.completed
- incident.created
- incident.resolved

Admin dashboard must update without requiring a page refresh.

---

# 20. Admin Dashboard

## Summary Cards

- Total Users
- Total Files
- Active Sessions
- Safe Users
- Suspicious Users
- High-Risk Incidents
- Critical Incidents
- Quarantined Files

## Risk Visualization

Display:

- Risk activity over time
- Severity distribution
- Security event frequency

Use Recharts.

## Live Feed

Example:

```text
22:14 User 42
87 modifications
CRITICAL

22:11 User 18
12 renames
HIGH

21:56 User 91
Normal upload
SAFE
```

---

# 21. Incident Investigation Page

Display:

```text
INCIDENT #SH-1042

User:
user_42

Risk:
94 / 100

Status:
CRITICAL
```

## Timeline

```text
22:14:01  Modification started
22:14:03  20 files modified
22:14:05  Mass rename detected
22:14:07  Canary triggered
22:14:08  ML anomaly detected
22:14:08  Account frozen
22:14:09  Files quarantined
```

## Evidence

Show:

- Rule signals
- ML anomaly score
- SHA-256 changes
- Entropy changes
- Canary trigger
- Affected files
- File versions

## Actions

- Restore safe version
- Keep quarantined
- Unfreeze user
- View activity

All actions require server-side authorization.

---

# 22. Shield AI Security Assistant

Shield AI is an administrator-facing Security Copilot.

It does not replace the detection engine.

## Responsibilities

- Explain incidents.
- Summarize security activity.
- Investigate actual events.
- Retrieve affected files.
- Explain risk scores.
- Answer security dashboard questions.
- Recommend investigation/recovery steps.

## Example Questions

```text
What happened in the latest incident?

Why was User 42 frozen?

Which files were affected?

Show today's critical incidents.

What caused the highest risk score?

Summarize this incident.

What should I investigate?

Show unusual activity from the last hour.

Explain this risk score.
```

---

# 23. AI Tool Calling

The AI must access data through controlled backend tools.

Recommended tools:

```text
getSecurityAlerts()
getCriticalIncidents()
getIncident(id)
getUserActivity(userId, timeRange)
getFileDetails(fileId)
getFileVersions(fileId)
getRiskBreakdown(incidentId)
getQuarantinedFiles()
getSecuritySummary()
```

Optional action tools:

```text
freezeUser(userId)
unfreezeUser(userId)
quarantineFile(fileId)
restoreVersion(fileId, versionId)
```

## Security Rules

The AI must never directly access MongoDB.

All actions go through authorized backend services.

Verify:

- Authentication
- Role
- Permission
- Resource access
- Security policy

Require explicit confirmation before destructive or recovery actions.

---

# 24. AI UI

Place Shield AI in the admin dashboard.

Features:

- Chat interface
- Conversation history
- Suggested prompts
- Incident context
- Security summaries
- Evidence references

Suggested buttons:

- Explain latest incident
- Show critical threats
- Why was this user frozen?
- Summarize today's security activity
- Find unusual activity
- Explain this risk score

The assistant must never invent security events.

If information is unavailable, state that it is unavailable.

---

# 25. User Dashboard

Display:

- File count
- Storage usage
- Recent files
- Recent activity
- Recent shares
- Security status
- Active sessions
- Security notifications

Keep administrator detection data private.

---

# 26. Recommended Database Collections

## User

```text
_id
name
email
passwordHash
role
status
securityStatus
createdAt
updatedAt
```

## File

```text
_id
ownerId
name
path/reference
size
mimeType
currentVersion
sha256
entropy
status
createdAt
updatedAt
```

## Version

```text
_id
fileId
versionNumber
storageReference
sha256
entropy
createdBy
securityStatus
createdAt
```

## Activity

```text
_id
userId
fileId
action
timestamp
directory
metadata
hashBefore
hashAfter
entropyBefore
entropyAfter
```

## Alert

```text
_id
userId
incidentId
riskScore
severity
reasons
status
createdAt
resolvedAt
```

## SecurityIncident

```text
_id
incidentNumber
userId
riskScore
severity
trigger
signals
affectedFiles
timeline
freezeStatus
quarantineStatus
resolution
createdAt
resolvedAt
```

## ShareLink

```text
_id
fileId
createdBy
tokenHash
permission
expiresAt
status
createdAt
```

## QuarantineItem

```text
_id
fileId
incidentId
originalReference
quarantineReference
reason
status
createdAt
```

---

# 27. Backend Project Structure

```text
server/
└── src/
    ├── config/
    ├── models/
    ├── routes/
    ├── controllers/
    ├── services/
    ├── security/
    │   ├── rules.engine.js
    │   ├── risk.engine.js
    │   ├── canary.service.js
    │   └── detection.service.js
    ├── middleware/
    ├── utils/
    └── server.js
```

Security/business logic must remain in services rather than being duplicated across controllers.

---

# 28. Frontend Project Structure

```text
client/
└── src/
    ├── pages/
    │   ├── Landing.jsx
    │   ├── Login.jsx
    │   ├── Register.jsx
    │   ├── Dashboard.jsx
    │   ├── Files.jsx
    │   ├── FileDetails.jsx
    │   ├── Shares.jsx
    │   ├── Versions.jsx
    │   ├── Activity.jsx
    │   ├── Security.jsx
    │   ├── AdminDashboard.jsx
    │   ├── Alerts.jsx
    │   ├── Incidents.jsx
    │   ├── IncidentDetails.jsx
    │   ├── Quarantine.jsx
    │   └── Recovery.jsx
    ├── components/
    ├── services/
    ├── context/
    └── App.jsx
```

---

# 29. Security Requirements

Implement:

- Password hashing
- JWT verification
- RBAC
- Rate limiting
- Input validation
- File validation
- File size limits
- Secure filenames
- Path traversal protection
- Secure share tokens
- Expiring links
- CORS
- Environment variables
- Error handling
- Audit logging

Never expose:

- Passwords
- JWT secrets
- API keys
- Internal filesystem paths
- Sensitive system information

---

# 30. Controlled Ransomware Simulation

Create a safe demo simulator that operates ONLY inside a dedicated demo directory.

Example:

```text
demo-data/
├── documents/
├── finance/
├── projects/
└── canary/
```

The simulator may generate:

- Rapid modifications
- Mass renames
- Extension changes
- Multi-directory activity
- Test entropy changes
- Canary triggers

It must not execute actual ransomware or affect unrelated files.

The purpose is to reliably demonstrate the ShieldShare detection pipeline.

---

# 31. Hackathon Demo Flow

Target duration: approximately 5 minutes.

## Step 1 — Normal Upload

Upload 3–5 files.

Display:

**SAFE**

## Step 2 — Secure Sharing

Create an expiring permission-based share link.

## Step 3 — Controlled Simulation

Run the demo ransomware-like activity simulator.

## Step 4 — Detection

Show:

```text
Behavior Rules → HIGH
SHA-256 → CHANGED
Entropy → CHANGED
Canary → TRIGGERED
ML → ANOMALY
Risk → 94/100
```

## Step 5 — Containment

Show:

```text
ACCOUNT FROZEN
FILES QUARANTINED
ADMIN ALERT
```

## Step 6 — AI Investigation

Ask Shield AI:

> Why was this account frozen?

Then:

> Which files were affected?

Then:

> Explain the risk score.

Responses must come from actual backend data.

## Step 7 — Recovery

Restore the last known safe version.

Display:

**RECOVERY COMPLETE**

---

# 32. UI/UX Requirements

The product must look like a professional cybersecurity SaaS application.

Use:

- Strong visual hierarchy
- Clean navigation
- Professional dashboard
- Security status cards
- Risk charts
- Incident timelines
- Data tables
- Severity badges
- Toast notifications
- Confirmation dialogs
- Loading states
- Empty states
- Error states
- Responsive design

Severity:

```text
SAFE        Green
SUSPICIOUS  Yellow
HIGH        Orange
CRITICAL    Red
INFO        Blue
```

Avoid excessive animations.

Do not create placeholder buttons that do nothing.

Do not display fake security statistics as if they were real.

---

# 33. Development Priority

## Priority 1 — Core Working MVP

- Authentication
- RBAC
- File upload/download
- File management
- Secure sharing
- Expiring links
- Versioning
- Activity logging
- SHA-256
- Behavioral rules
- Risk scoring
- Canary files
- Freeze
- Quarantine
- Alerts
- Recovery

## Priority 2 — Advanced Features

- Entropy analysis
- Isolation Forest
- Socket.IO real-time events
- Shield AI Assistant

## Priority 3 — Future Scope

- Immutable/WORM storage
- Advanced sequential ML
- EDR integration
- Hardware-backed attestation
- Advanced forensic reporting
- Enterprise integrations

Do not allow advanced features to destabilize the core MVP.

---

# 34. Development Rules

Before making changes:

1. Inspect the existing project.
2. Identify the current architecture.
3. Reuse working code.
4. Do not rewrite functioning components unnecessarily.
5. Preserve MERN architecture.
6. Do not remove working features.
7. Fix broken flows before adding features.
8. Keep frontend/backend API contracts synchronized.
9. Use proper error handling.
10. Test major workflows.
11. Keep security logic modular.
12. Keep secrets out of source control.

Never implement fake functionality just to make a screen look complete.

---

# 35. Definition of Done

The complete end-to-end workflow must work:

```text
Register
→ Login
→ Dashboard
→ Upload files
→ SHA-256
→ Version creation
→ Share file
→ Expiring link
→ Activity logging
→ Controlled ransomware simulation
→ Behavioral detection
→ Entropy signal
→ Canary trigger
→ Isolation Forest anomaly
→ Risk score
→ Security incident
→ Freeze
→ Quarantine
→ Real-time admin alert
→ Incident investigation
→ Shield AI explanation
→ View affected files
→ View versions
→ Restore safe version
→ File becomes accessible again
```

A feature is not considered complete if the UI exists but the backend workflow does not function.

---

# 36. Product Positioning

Product name:

**ShieldShare**

Product title:

**Secure File Sharing with Intelligent Ransomware Detection & Recovery**

Core message:

> **Share securely. Detect abnormal behavior. Explain the risk. Contain the threat. Recover safely. Investigate with AI.**

The final architecture should clearly separate:

**Detection**
→ Security engine

**ML**
→ Behavioral anomaly signal

**Risk**
→ Explainable decision layer

**Response**
→ Freeze + quarantine + alert

**Recovery**
→ Safe version restoration

**AI**
→ Investigation and Security Copilot

---

# 37. Final Acceptance Test

Before declaring the project complete, verify:

- A new user can register.
- User can log in.
- User can upload files.
- SHA-256 is generated.
- File version is created.
- User can share a file.
- Expiring links work.
- File operations create activity records.
- Controlled simulator generates suspicious activity.
- Rules detect suspicious activity.
- Canary detection works.
- Entropy signal works where supported.
- Isolation Forest returns an anomaly result where enabled.
- Risk engine produces a score.
- Risk reasons are displayed.
- Critical activity freezes the account/session.
- Suspicious files are quarantined.
- Admin receives a real-time alert.
- Admin can inspect the incident.
- Shield AI retrieves real incident data.
- Shield AI explains the incident.
- Admin can restore a safe version.
- Restored file is accessible.
- No unauthorized user can perform admin/security actions.
- No secrets are committed.
- No critical workflow depends on fake/mock data.

---

# 38. Implementation Principle

Build the **working security product first**.

Then add:

1. Advanced detection
2. ML
3. AI assistant
4. Real-time polish
5. Visual polish

The project should remain functional even if the ML or AI service is temporarily unavailable.

The core ShieldShare security engine must continue to operate using deterministic detection rules and integrity signals.
