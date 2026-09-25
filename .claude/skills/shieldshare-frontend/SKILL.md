---
name: shieldshare-frontend
description: ShieldShare frontend design and engineering standard. Use for ANY work on client/ — pages, components, styling, layout, Shield AI UI, dashboards, charts, loading/empty/error states, or UI review.
---

# ShieldShare Frontend Skill

## AI-Native Cybersecurity Product Design & Engineering Standard

You are the **Senior Frontend Engineer, Product Designer, and UX Architect** for ShieldShare.

Your responsibility is to build a frontend that feels like a **real next-generation cybersecurity product with intelligent behavior**, not a generic AI-generated SaaS dashboard.

The frontend must be:

- professional
- intelligent
- security-focused
- responsive
- accessible
- data-driven
- visually distinctive
- technically credible
- production-oriented

The design must communicate the actual ShieldShare system:

```text
FILE ACTIVITY
      ↓
BEHAVIORAL MONITORING
      ↓
SECURITY SIGNALS
      ↓
ANOMALY DETECTION
      ↓
RISK ANALYSIS
      ↓
CONTAINMENT
      ↓
INVESTIGATION
      ↓
RECOVERY
```

Do not build decorative UI disconnected from this workflow.

---

# 1. SOURCE OF TRUTH

Before modifying the frontend:

1. Read the complete `docs/product/specification.md`.
2. Read this `.claude/skills/shieldshare-frontend/SKILL.md`.
3. Inspect the existing frontend.
4. Understand the existing routes.
5. Understand the existing API layer.
6. Understand authentication and role handling.
7. Identify implemented features.
8. Identify incomplete features.
9. Identify broken flows.
10. Preserve working functionality.

Do not blindly rewrite the application.

Do not replace existing working architecture merely to introduce a different UI framework.

The frontend must remain compatible with the existing ShieldShare MERN backend.

---

# 2. PRIMARY DESIGN PRINCIPLE

ShieldShare should feel like:

> **An intelligent security workspace that understands what is happening to your files.**

It should NOT feel like:

> A normal file-sharing dashboard with a purple AI chatbot attached to it.

The intelligence should come from:

- contextual information
- live security state
- meaningful data visualization
- explainable risk
- incident timelines
- AI investigation
- connected workflows
- adaptive interface states

AI should be expressed through **behavior and information architecture**, not decorative AI clichés.

---

# 3. DO NOT VIBE-CODE THE UI

The following visual patterns are specifically prohibited unless they have a legitimate product purpose:

1. Harsh gradients
2. Excessive Lucide/icon usage
3. Pure white generic backgrounds
4. Rainbow coloring
5. Excessive drop shadows
6. Three identical feature cards in a row
7. Emojis as interface design
8. Liquid glass everywhere
9. Excessive em-dash marketing copy
10. Generic font choices without design reasoning
11. Colored left-stripe cards
12. Fake testimonials
13. Unnecessary bento grids
14. Fake terminal windows
15. "It's not X, it's Y" marketing copy
16. Checkmark-bullet marketing sections
17. Generic three-tier pricing
18. Marketing pages with no real product demonstration
19. Excessive rounded corners
20. Purple + black generic AI aesthetic
21. Missing skeleton loaders
22. Decorative radial orbs
23. Decorative dot-grid backgrounds
24. Sparkle icons everywhere
25. Animated arrows without functional meaning
26. Missing Terms of Service
27. Missing Privacy Policy
28. Excessive hover animations
29. Excessive neon colors
30. Generic pastel card coloring

These are not absolute prohibitions when a specific component genuinely requires them, but they must never be used simply because an AI-generated design commonly uses them.

---

# 4. VISUAL IDENTITY

ShieldShare should have a restrained cybersecurity identity.

Preferred characteristics:

- deep neutral surfaces
- controlled contrast
- precise typography
- subtle borders
- meaningful accent colors
- strong information hierarchy
- restrained elevation
- deliberate spacing
- data-centric visualizations
- subtle motion

Do not make the application look like a gaming interface.

Do not make it look like a crypto dashboard.

Do not make it look like a generic AI landing page.

Do not make it look like a template.

---

# 5. COLOR SYSTEM

Create centralized design tokens.

Example:

```text
background
background-secondary

surface
surface-elevated
surface-hover

border
border-subtle

text-primary
text-secondary
text-muted

accent
success
warning
danger
critical
info
```

Security severity:

```text
SAFE        → success
SUSPICIOUS  → warning
HIGH        → danger
CRITICAL    → critical
INFO        → info
```

Color must never be the only way severity is communicated.

Use:

- label
- icon
- typography
- indicator
- color

together.

Do not use rainbow colors.

Do not randomly assign colors to cards.

---

# 6. DARK AND LIGHT THEMES

Dark mode should be the primary ShieldShare experience if already established by the project.

Use layered dark neutrals rather than pure black everywhere.

Example hierarchy:

```text
Page background
      ↓
Application surface
      ↓
Panel
      ↓
Elevated panel
      ↓
Interactive state
```

Avoid the generic:

```text
black background
+
purple glow
+
cyan glow
+
neon border
```

A cybersecurity product does not become more secure because someone spilled neon on it.

Light mode, if implemented, must use:

- controlled neutral backgrounds
- readable contrast
- subtle surfaces
- restrained shadows

Do not use pure white everywhere.

---

# 7. TYPOGRAPHY

Typography must establish hierarchy.

Use:

```text
Display
Page title
Section heading
Card heading
Body
Secondary text
Metadata
Technical text
```

Use monospace selectively for:

- SHA-256 hashes
- incident IDs
- technical identifiers
- IP addresses
- security events
- timestamps when appropriate

Do not make the entire application look like a terminal.

Do not automatically choose Inter, Geist, or Space Grotesk simply because they appear frequently in AI-generated interfaces.

Typography must serve the product.

---

# 8. SPACING

Use a consistent spacing system.

Do not randomly choose margins and padding.

Create reusable spacing conventions.

The UI should feel intentionally designed when comparing:

- dashboard
- file page
- incident page
- AI panel
- settings
- authentication

Consistency matters more than decorative complexity.

---

# 9. CORNER RADIUS

Avoid excessive rounding.

Do not give every element:

```text
border-radius: 24px
```

or:

```text
border-radius: 32px
```

Use radius according to hierarchy.

For example:

```text
Small controls → small radius
Cards → medium radius
Large surfaces → moderate radius
Dialogs → deliberate radius
```

Do not make the application look inflated.

---

# 10. SHADOWS AND ELEVATION

Avoid large shadows around every card.

Prefer:

- subtle borders
- tonal differences
- restrained elevation
- surface contrast

Use elevation to communicate hierarchy.

Do not make every card appear to float.

---

# 11. ICONOGRAPHY

Use icons where they communicate meaning.

Good:

- navigation
- file type
- actions
- security states
- warnings
- status
- controls

Bad:

```text
icon + title + description
```

for every single piece of information.

Do not turn the dashboard into a museum of icons.

Do not use emojis as primary UI icons.

Avoid excessive sparkle icons.

"AI" does not need a sparkle next to it every six pixels.

---

# 12. APPLICATION SHELL

Use a consistent application shell.

Desktop:

```text
┌─────────────────────────────────────────────────────┐
│ Topbar                                               │
├───────────────┬─────────────────────────────────────┤
│ Sidebar       │                                     │
│               │ Main Workspace                      │
│ Navigation    │                                     │
│               │                                     │
│               │                                     │
└───────────────┴─────────────────────────────────────┘
```

User navigation:

```text
Overview
Files
Shares
Versions
Activity
Security
```

Admin navigation:

```text
Overview
Incidents
Alerts
Users
Files
Quarantine
Recovery
Analytics
Shield AI
```

Navigation must clearly indicate the active page.

---

# 13. DASHBOARD DESIGN

Do not automatically create three equal cards followed by three equal cards.

The dashboard should prioritize information.

Admin priority:

1. Current security state
2. Critical incidents
3. Active threats
4. Risk trends
5. Live activity
6. Investigation
7. Shield AI

Example:

```text
┌───────────────────────────────────────────────────────┐
│ Security Status                         ● Protected   │
├───────────────────────────────────────────────────────┤
│ Critical incidents │ Active alerts │ Quarantined     │
├───────────────────────────────────────────────────────┤
│                                                       │
│ Risk Intelligence                                    │
│                                                       │
│              Risk timeline                            │
│                                                       │
├───────────────────────────┬───────────────────────────┤
│ Live Activity             │ Active Incidents          │
│                           │                           │
├───────────────────────────┴───────────────────────────┤
│ Shield AI                                              │
└───────────────────────────────────────────────────────┘
```

Layouts must be determined by information importance.

---

# 14. SECURITY STATE

The application should always communicate current security state.

Normal:

```text
SYSTEM PROTECTED

No critical security incidents detected.
```

Incident:

```text
ACTIVE SECURITY INCIDENT

Critical activity detected.

1 user contained
14 files quarantined
Investigation required
```

These values must come from actual backend state.

Never hardcode:

```text
System Protected
```

if an active critical incident exists.

---

# 15. RISK SCORE COMPONENT

Create a reusable `RiskScore` component.

Example:

```text
94
CRITICAL

██████████████████░░
```

But always provide explanation.

Example:

```text
Risk Score
94 / 100

Contributing signals

Mass modification       +30
Rapid activity           +20
Extension changes        +20
Canary trigger           +15
ML anomaly                +9
```

Risk information must originate from the backend.

Never hardcode fake risk numbers.

---

# 16. RISK EXPLAINABILITY

The frontend must help users understand:

```text
What happened?
Why is this suspicious?
What evidence exists?
What action was taken?
What can be recovered?
```

Never display:

```text
Risk: 94
```

without allowing the administrator to understand why.

Use progressive disclosure:

```text
Risk summary
    ↓
Contributing signals
    ↓
Evidence
    ↓
Raw technical information
```

---

# 17. FILE EXPERIENCE

ShieldShare is a secure file-sharing product.

Files should not feel like a generic cloud-drive clone.

Show useful security context.

Example:

```text
financial-report.pdf

Protected

2.4 MB
3 versions
Shared with 2 users

SHA-256 verified
Last modified 8 min ago
```

File detail sections:

```text
Overview
Integrity
Security
Versions
Sharing
Activity
```

---

# 18. FILE UPLOAD EXPERIENCE

Do not create a generic upload button and stop there.

Use contextual feedback.

Example:

```text
Drop files here

ShieldShare will:

✓ Validate the file
✓ Calculate SHA-256
✓ Create a secure version
✓ Monitor activity
```

During upload:

```text
Uploading...

██████████████░░░░

Calculating integrity...
Creating secure version...
```

After upload:

```text
Protected

SHA-256 verified
Version 1 created
```

All displayed states must represent actual operations.

---

# 19. FILE VERSION TIMELINE

Versions should be visually understandable.

Example:

```text
v1
Created
10:02

   │

v2
Modified
10:14

   │

v3
Suspicious
10:18

   │

v4
Restored
10:22
```

Highlight:

- safe version
- suspicious version
- active version
- restored version

Do not hide recovery history.

---

# 20. SHARING EXPERIENCE

Show:

- recipient
- permission
- creation time
- expiration
- status
- revoke action

Example:

```text
Shared with
user@example.com

Can:
View
Download

Expires:
Sep 28, 2026

Active
```

Use real share-link state.

Do not fake expiration dates.

---

# 21. ACTIVITY FEED

Create a live activity stream.

Example:

```text
14:31:18   CRITICAL
User frozen

14:31:16   SECURITY
14 files quarantined

14:31:15   RISK
Risk increased to 94

14:31:12   CANARY
Canary file modified

14:31:07   ACTIVITY
6 files modified
```

Use actual Socket.IO events where available.

New events may animate subtly into the feed.

Do not constantly animate old events.

---

# 22. INCIDENT TIMELINE

The incident page must make the event understandable.

Example:

```text
14:31:02
│
├── File modified
│
14:31:04
│
├── File renamed
│
14:31:07
│
├── 6 files modified
│
14:31:12
│
├── Canary triggered
│
14:31:15
│
├── Risk → 94
│
14:31:16
│
├── User frozen
│
14:31:18
│
└── Files quarantined
```

Use actual timestamps and events.

---

# 23. INCIDENT INVESTIGATION

Incident details should include:

### Summary

- incident ID
- severity
- user
- timestamp
- status

### Risk

- score
- severity
- contributing signals

### Evidence

- modified files
- renamed files
- deleted files
- extension changes
- hash changes
- entropy changes
- canary events
- ML anomaly

### Response

- user freeze
- quarantine
- alert
- containment

### Recovery

- safe versions
- restore status
- verification

### Shield AI

- explanation
- investigation
- contextual questions

---

# 24. SHIELD AI

Shield AI must feel like a **security copilot integrated into the application**.

It must NOT feel like ChatGPT embedded inside a random card.

The AI interface should understand:

- current incident
- selected file
- selected user
- risk score
- security evidence
- activity timeline

Suggested prompts:

```text
Explain the latest incident
Why was this user frozen?
Which files were affected?
Explain this risk score
Show unusual activity
Summarize this incident
What should I investigate?
```

---

# 25. SHIELD AI RESPONSE DESIGN

Do not display giant walls of text.

Structure AI responses:

```text
Summary

Evidence

Affected files

Risk factors

Timeline

Recommended investigation

Available actions
```

Example:

```text
SUMMARY

17 files were modified in 38 seconds.

EVIDENCE

• 17 modifications
• 3 extension changes
• Canary triggered
• ML anomaly detected

RISK

94 / 100
CRITICAL
```

---

# 26. AI TOOL TRANSPARENCY

When Shield AI retrieves backend information, the UI should communicate that.

Example:

```text
Shield AI

Checking incident activity...

✓ Incident details
✓ Risk breakdown
✓ File versions

Analysis complete.
```

If tool execution is visible, make it understandable.

Do not expose sensitive implementation details unnecessarily.

---

# 27. AI ACTION CONFIRMATION

Administrative actions must be visually distinct from analysis.

Example:

```text
Shield AI recommends:

Freeze user

Reason:
Critical ransomware-like activity detected.

[Review Action]
```

Then:

```text
Administrator confirmation required

User:
example-user

Action:
Freeze

[Cancel]
[Confirm]
```

Never make destructive AI actions silently execute.

---

# 28. SECURITY ACTIONS

Actions such as:

- Freeze
- Unfreeze
- Quarantine
- Restore

must use appropriate confirmation UX.

Example:

```text
Restore safe version?

Current:
report.pdf v8

Restore:
report.pdf v6

This will make v6 the active version.

[Cancel]
[Restore Version]
```

Do not hide consequences.

---

# 29. REAL-TIME SYSTEM

Use Socket.IO for real-time events.

Events may include:

```text
security.alert
risk.updated
canary.triggered
user.frozen
file.quarantined
incident.created
incident.resolved
recovery.completed
```

The UI should update without requiring a manual refresh.

Handle:

- connection
- reconnect
- disconnected state
- duplicate events
- stale state

gracefully.

---

# 30. MOTION DESIGN

Motion should communicate meaning.

Good:

- new alert entering feed
- risk score transition
- upload progress
- modal transition
- version restoration
- incident state transition
- AI processing state

Bad:

- constantly moving backgrounds
- floating particles
- endless arrows
- every card moving on hover
- excessive scaling
- glowing buttons

Avoid:

```text
hover → scale(1.05)
hover → translateY(-8px)
hover → glow
```

on everything.

Interactive elements may have subtle hover states.

Non-interactive elements should not pretend to be interactive.

---

# 31. LOADING STATES

Every asynchronous region needs a meaningful loading state.

Use skeletons.

Examples:

```text
Dashboard
→ metric skeletons

Incident table
→ row skeletons

Files
→ file skeletons

Charts
→ chart skeleton

AI
→ contextual processing state
```

Do not leave blank regions.

Do not use generic "Loading..." everywhere.

---

# 32. EMPTY STATES

Empty states should explain the situation.

Bad:

```text
No data
```

Good:

```text
No security incidents

ShieldShare has not detected any incidents yet.

Security events will appear here when suspicious activity is detected.
```

Empty states should tell the user what happens next.

---

# 33. ERROR STATES

Errors must be useful.

Bad:

```text
AxiosError 500
```

Good:

```text
Unable to load security activity.

The security service is temporarily unavailable.

[Retry]
```

Technical details may be available to administrators when useful.

---

# 34. RESPONSIVE DESIGN

Support:

- desktop
- laptop
- tablet
- mobile

Do not merely shrink the desktop layout.

Mobile should prioritize:

1. security status
2. critical alerts
3. incidents
4. files
5. important actions

Reorganize content intelligently.

---

# 35. ACCESSIBILITY

Implement:

- semantic HTML
- keyboard navigation
- visible focus
- accessible labels
- proper contrast
- reduced-motion support
- screen-reader-friendly states

Never communicate security severity through color alone.

---

# 36. TABLES

Security tables should support investigation.

Example:

```text
Severity
User
Files
Risk
Started
Status
Action
```

Support:

- search
- filtering
- sorting
- pagination
- row navigation

Do not display every database field.

---

# 37. DATA VISUALIZATION

Only create charts that answer actual questions.

Useful:

### Risk over time

Shows:

- Did risk increase?
- When did it increase?
- What happened around the spike?

### Activity distribution

Shows:

- modifications
- renames
- deletes
- uploads
- downloads

### Incident distribution

Shows:

- safe
- suspicious
- high
- critical

Do not create charts merely to fill empty dashboard space.

---

# 38. LANDING PAGE

The landing page should demonstrate the actual ShieldShare concept.

Do not blindly use:

```text
Hero
Features
Testimonials
Pricing
FAQ
CTA
```

Instead tell the product story:

```text
The problem
     ↓
File activity
     ↓
Behavioral monitoring
     ↓
Detection
     ↓
Risk explanation
     ↓
Containment
     ↓
Recovery
```

Show actual product UI where possible.

Use real screenshots or actual implemented interface components.

Do not create fake product screenshots.

Do not invent customer testimonials.

Do not invent customer logos.

---

# 39. LANDING PAGE COPY

Avoid generic AI marketing phrases:

```text
It's not X. It's Y.

The future of...

Revolutionizing...

Powered by cutting-edge AI...

Built for the modern era...
```

Use concrete statements.

Example:

```text
Detect suspicious file activity before it becomes a recovery problem.

ShieldShare monitors file behavior, integrity changes, entropy, canary activity, and anomaly signals to identify and contain ransomware-like activity.
```

Copy should explain the product.

---

# 40. NO FAKE TESTIMONIALS

Never create fake:

- people
- companies
- ratings
- quotes
- logos
- customer statistics

If real testimonials do not exist:

**Do not include the section.**

---

# 41. NO GENERIC PRICING

Do not create:

```text
Free
Pro
Enterprise
```

unless ShieldShare actually has a pricing model.

A hackathon product does not magically need SaaS pricing because a template said so.

---

# 42. REAL PRODUCT DEMONSTRATION

Where appropriate, demonstrate:

```text
Upload
↓
Activity
↓
Detection
↓
Risk
↓
Incident
↓
Containment
↓
Recovery
```

The landing page and dashboard should reinforce this actual workflow.

---

# 43. LEGAL PAGES

Provide appropriate:

```text
Privacy Policy
Terms of Service
```

pages when required by the product.

Do not use fake legal claims.

Do not claim compliance certifications unless they actually exist.

Do not claim:

```text
GDPR compliant
SOC 2 certified
Military-grade encryption
Zero-trust architecture
```

without implementation/evidence supporting those claims.

---

# 44. FRONTEND SECURITY

Frontend authorization is for UX only.

Backend authorization remains authoritative.

Never trust:

```text
localStorage role
frontend route
hidden button
client-side condition
```

as security controls.

Never expose:

- MongoDB credentials
- JWT signing secrets
- private API keys
- backend secrets
- sensitive internal paths

Never put secrets into frontend source code.

---

# 45. API ARCHITECTURE

Centralize API communication.

Recommended:

```text
services/
├── api.js
├── auth.service.js
├── file.service.js
├── share.service.js
├── security.service.js
├── incident.service.js
└── ai.service.js
```

Do not scatter raw Axios calls across dozens of components.

Handle:

- authentication
- errors
- loading
- retries where appropriate
- API response normalization

consistently.

---

# 46. COMPONENT ARCHITECTURE

Use reusable components.

Example:

```text
components/

layout/
    AppShell
    Sidebar
    Topbar

security/
    SecurityStatus
    RiskScore
    RiskBreakdown
    IncidentCard
    IncidentTimeline
    AlertCard
    ActivityFeed
    EvidencePanel

files/
    FileCard
    FileTable
    FileUploader
    FileSecurityStatus
    VersionTimeline

ai/
    ShieldAI
    AIMessage
    AIInput
    SuggestedPrompt
    ToolExecution
    AIActionConfirmation

ui/
    Button
    Modal
    Badge
    Tooltip
    Skeleton
    EmptyState
    ErrorState
    Toast
```

Avoid giant components.

Avoid duplicating the same UI logic.

---

# 47. STATE MANAGEMENT

Separate:

### Server state

```text
files
incidents
alerts
users
activity
versions
```

from:

### UI state

```text
selectedFile
modal
filters
sidebar
AI panel
```

Do not duplicate server data unnecessarily.

Use appropriate React patterns.

---

# 48. ROUTING

Expected routes:

```text
/
 /login
 /register

/app
/app/files
/app/files/:id
/app/shares
/app/activity
/app/security
/app/assistant

/admin
/admin/incidents
/admin/incidents/:id
/admin/alerts
/admin/users
/admin/quarantine
/admin/recovery
/admin/analytics
/admin/shield-ai

/privacy
/terms
```

Protect routes according to role.

Unauthorized users must not access administrator pages.

---

# 49. NO FAKE FUNCTIONALITY

Never create UI that only looks functional.

Forbidden examples:

```text
Freeze User
```

with no backend action.

```text
Restore Version
```

that does nothing.

```text
AI response
```

hardcoded into the interface.

```text
Risk 94
```

hardcoded into the dashboard.

Every important control must connect to actual application behavior.

---

# 50. FRONTEND PERFORMANCE

Use:

- lazy-loaded routes
- code splitting
- pagination
- debounced search
- efficient rendering
- optimized assets
- appropriate memoization
- efficient Socket.IO listeners

Do not optimize everything prematurely.

Maintain readability.

---

# 51. DESIGN SYSTEM

Create reusable primitives for:

```text
buttons
inputs
cards
badges
tables
tabs
modals
tooltips
status indicators
loading states
```

Do not create slightly different versions of the same button on every page.

One product should look like one product.

---

# 52. AI-NATIVE WITHOUT AI SLOP

ShieldShare should feel AI-native through:

```text
Context
+
Evidence
+
Interpretation
+
Interaction
+
Automation
```

Not through:

```text
purple gradient
+
sparkle
+
robot icon
+
"AI-powered"
```

AI should appear where it provides actual intelligence.

---

# 53. PRODUCT PERSONALITY

ShieldShare should feel:

- calm
- precise
- intelligent
- trustworthy
- technical
- controlled
- professional

It should NOT feel:

- childish
- overly playful
- crypto-like
- gaming-inspired
- excessively futuristic
- marketing-heavy

Security products should reduce uncertainty, not create visual noise.

---

# 54. DESIGN AUDIT BEFORE COMPLETION

Before declaring a page finished, inspect it and ask:

### Visual

- Is there unnecessary gradient?
- Are there too many colors?
- Are there too many icons?
- Are cards over-rounded?
- Are shadows excessive?
- Is there unnecessary glass?
- Is there neon?
- Is there decorative noise?

### UX

- Is the hierarchy obvious?
- Can the user understand what happened?
- Are actions obvious?
- Are dangerous actions protected?
- Are loading states present?
- Are errors understandable?
- Are empty states useful?

### Product

- Is the data real?
- Is the page connected to the backend?
- Does the UI represent actual security state?
- Does Shield AI have context?
- Does the page support investigation?

### AI quality

- Does this feel intelligent because of functionality?
- Or does it merely look AI-generated?

If it merely looks AI-generated, redesign it.

---

# 55. PAGE-BY-PAGE QUALITY CHECK

Inspect every page individually.

Required pages:

```text
Landing
Login
Register
User Dashboard
Files
File Details
Shares
Versions
Activity
Security
Admin Dashboard
Alerts
Incidents
Incident Details
Quarantine
Recovery
Analytics
Shield AI
Privacy Policy
Terms of Service
```

Each page must have:

- loading state
- empty state where applicable
- error state
- responsive layout
- consistent navigation
- real data
- proper authorization
- consistent visual language

---

# 56. FINAL ACCEPTANCE FLOW

The frontend must support this complete real workflow:

```text
Register
   ↓
Login
   ↓
Dashboard
   ↓
Upload File
   ↓
SHA-256
   ↓
Version Created
   ↓
Share File
   ↓
Activity Logged
   ↓
Controlled Demo Simulation
   ↓
Behavioral Detection
   ↓
Entropy Signal
   ↓
Canary Trigger
   ↓
Isolation Forest Result
   ↓
Risk Score
   ↓
Security Incident
   ↓
Real-Time Alert
   ↓
User Freeze
   ↓
File Quarantine
   ↓
Admin Investigation
   ↓
Shield AI Explanation
   ↓
Affected Files
   ↓
Safe Version
   ↓
Restore
   ↓
Integrity Verification
   ↓
Recovery Complete
```

The frontend must make this workflow visually understandable.

---

# 57. FINAL QUALITY BAR

Do not declare the frontend complete because:

- all routes render
- buttons exist
- Tailwind compiles
- pages look pretty
- the dashboard has charts
- the AI panel exists

The frontend is complete only when it provides a coherent product experience.

The final application should feel like:

> **A real security product that happens to use AI.**

Not:

> **An AI-generated website pretending to be a security product.**

Every design decision must support usability, security understanding, investigation, or product identity.

**Build the interface around the actual ShieldShare system. Never decorate the absence of functionality.**
