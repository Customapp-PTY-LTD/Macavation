# Process-Driven Design Principles

A framework for transforming admin-heavy systems into intuitive, action-oriented solutions.

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [The Mindset Shift](#the-mindset-shift)
3. [Design Principles](#design-principles)
4. [Implementation Patterns](#implementation-patterns)
5. [UI Component Patterns](#ui-component-patterns)
6. [Anomaly Detection Framework](#anomaly-detection-framework)
7. [Workflow Design Guidelines](#workflow-design-guidelines)
8. [Mobile-First Field Interfaces](#mobile-first-field-interfaces)
9. [Notification & Escalation Framework](#notification--escalation-framework)
10. [Metrics & Dashboard Design](#metrics--dashboard-design)
11. [Checklist for Applying Principles](#checklist-for-applying-principles)

---

## Core Philosophy

### The Problem with Traditional Admin Systems

Most business applications are built around **data structures**, not **user workflows**:

- Users navigate to modules to find information
- CRUD operations dominate the interface
- Reports tell users what happened (reactive)
- Problems are discovered through manual analysis
- High cognitive load to connect information across modules

### The Process-Driven Alternative

Build systems around **how users work**, not how data is organized:

- Surface what needs attention proactively
- Guide users through multi-step processes
- Predict problems before they occur
- Connect related information automatically
- Minimize navigation, maximize action

---

## The Mindset Shift

| Traditional Approach | Process-Driven Approach |
|---------------------|-------------------------|
| Navigate to find problems | Problems surface to you |
| Module-first architecture | Workflow-first architecture |
| Static dashboards | Dynamic, exception-driven views |
| CRUD-heavy data entry | Wizard-guided processes |
| Siloed modules | Connected workflows with impact visibility |
| Desktop admin focus | Field-ready interfaces for high-frequency tasks |
| Reports tell you what happened | Predictions tell you what will happen |
| Compliance as separate concern | Compliance embedded in operations |

---

## Design Principles

### Principle 1: Exception-First Design

**Show what's wrong, not what's right.**

Users don't need dashboards confirming "everything is fine" — they need immediate visibility into exceptions, anomalies, and items requiring action.

#### Implementation:
- Calculate thresholds for "normal" vs. "out of norm"
- Surface exceptions at the top of every view
- Provide context: *why* it's an exception and *what's the impact*
- Include actionable buttons on every exception card

#### Example Structure:
```
┌────────────────────────────────────────────────────┐
│ 🔴 REQUIRES IMMEDIATE ACTION (count)               │
│ ┌────────────────────────────────────────────────┐ │
│ │ [Icon] EXCEPTION TITLE                         │ │
│ │ Description with context and impact            │ │
│ │ Metric: X | Threshold: Y | Gap: Z              │ │
│ │ [Primary Action] [Secondary Action] [Dismiss]  │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

---

### Principle 2: Role-Based Workflow Views

**Different users have different daily workflows.**

Instead of one interface that tries to serve everyone, provide role-specific "My Day" views that guide users through their actual responsibilities.

#### Implementation:
- Map the daily workflow for each role
- Generate personalized task lists based on schedules, data, and business rules
- Include a "Watching" section for proactive intelligence
- Allow users to complete tasks inline without navigation

#### Example Structure:
```
┌────────────────────────────────────────────────────┐
│ Good morning, [Name] | [Context] | [Date]          │
├────────────────────────────────────────────────────┤
│ TODAY'S WORKFLOW                                   │
│ ☑️ [Time] Task completed [Review]                   │
│ ⬜ [Time] Task pending [Action]                     │
│ ⬜ [Time] Task pending [Action]                     │
├────────────────────────────────────────────────────┤
│ WATCHING                                           │
│ • Proactive insight 1                              │
│ • Proactive insight 2                              │
└────────────────────────────────────────────────────┘
```

---

### Principle 3: Context-Aware Metrics

**Numbers without context are meaningless.**

Always show metrics with:
- Comparison to target/threshold
- Trend (improving or declining)
- Visual indicator (progress bar, color coding)
- Drill-down to exceptions

#### Implementation:
```
┌────────────────────────────────────────────────────┐
│ [METRIC NAME]                                      │
│ [Value] | [Unit]                                   │
│ ████████████░░░░░░░░ [X]% (target: [Y]%)          │
│ 📈 Trend: [+/-X]% vs. [comparison period]          │
│ ⚠️ [N] items below threshold: [Investigate]        │
└────────────────────────────────────────────────────┘
```

---

### Principle 4: Connected Workflows

**Real work spans multiple data domains.**

When users take an action, show the downstream impacts across the system. Prevent non-compliant or conflicting actions before they're committed.

#### Implementation:
- Identify process chains (Action A → affects B → impacts C)
- Display linked records when creating/editing
- Show impact warnings before save
- Auto-create related records where possible

#### Example Structure:
```
┌────────────────────────────────────────────────────┐
│ [ACTION FORM]                                      │
│                                                    │
│ 📋 LINKED RECORDS                                  │
│ ├── [Related Record 1] ✓                           │
│ ├── [Impact 1] ⚠️ Warning message                  │
│ ├── [Auto-created Record]                          │
│ └── [Compliance Check] ✓                           │
│                                                    │
│ [Save & Continue] [Resolve Conflicts First]        │
└────────────────────────────────────────────────────┘
```

---

### Principle 5: Reduce Friction for High-Frequency Tasks

**The 80/20 rule applies to user actions.**

Identify the 20% of tasks that users perform 80% of the time. These should be:
- Accessible without navigation (Quick Actions)
- Completable in minimal clicks/taps
- Pre-filled with smart defaults
- Support copy/template patterns for repetitive work

#### Implementation:
- Add Quick Actions panel to dashboard/home
- Open focused modals instead of navigating to full modules
- Pre-populate based on recent entries or patterns
- Provide "Copy from [previous/template]" options

---

### Principle 6: Proactive Intelligence

**Tell users what will happen, not just what happened.**

Move from reactive reporting to predictive insights:
- Project trends forward
- Identify patterns before they become problems
- Suggest actions based on data analysis

#### Examples:
| Reactive | Proactive |
|----------|-----------|
| "You used 8,500 units this month" | "At current rate, you'll exceed your limit by 340 units" |
| "3 certificates expired" | "5 certificates expire in 2 weeks — bottleneck risk" |
| "Task is overdue" | "This task is trending 2 days behind schedule" |

---

### Principle 7: Embedded Compliance

**Don't make compliance a separate destination.**

Compliance checks should happen inline during normal workflows, not as a separate module users must remember to visit.

#### Implementation:
- Validate compliance requirements during data entry
- Block non-compliant actions with clear explanations
- Auto-generate compliance records from operational data
- Surface expiring certifications/requirements contextually

#### Pattern:
```
When: [User performs action]
Check: [Relevant compliance requirement]
If valid: Proceed silently (or show ✓)
If invalid: Block + explain + offer resolution path
```

---

### Principle 8: Mobile-First for Field Work

**Field users need radically simpler interfaces.**

If your system has users working "in the field" (warehouse, farm, factory floor, etc.), design a separate touch-first experience.

#### Principles:
- **3-tap maximum** for any action
- **Offline-first** with background sync
- **Large touch targets** (minimum 44×44 px)
- **Photo-centric** — faster than typing
- **Context-aware** — location, time, assigned tasks

---

## Implementation Patterns

### Pattern 1: Operations Hub (Replaces Static Dashboard)

Transform the dashboard from a module launcher into an intelligent command centre.

#### Sections (in priority order):
1. **Critical Exceptions** — Items requiring immediate action
2. **Due This Period** — Upcoming deadlines and scheduled items
3. **Today's Pulse** — Key operational metrics at a glance
4. **Quick Actions** — Shortcuts to high-frequency tasks
5. **Recent Activity** — Audit trail (lowest priority)

---

### Pattern 2: Wizard-Guided Processes

For multi-step processes, guide users through each step instead of presenting a complex form.

#### Structure:
```
Step 1 of N: [Step Title]
━━━━━━━━━━━━━━━━━━━━━━━━━━
[Progress indicator: ●○○○]

[Step content / form fields]

[← Back] [Save Draft] [Next Step →]
```

#### When to Use:
- Process has 3+ distinct steps
- Steps have dependencies
- User might need to pause and resume
- Process creates multiple related records

---

### Pattern 3: Copy-and-Adjust Pattern

For repetitive data entry (e.g., daily allocations, weekly reports), provide copy functionality.

#### Structure:
```
┌────────────────────────────────────────────────────┐
│ Start from: [Previous Entry ▼]  Date: [Today]      │
│                                                    │
│ CHANGES FROM PREVIOUS                              │
│ [Item 1]: [Previous Value] → [New Value ▼] ✓       │
│ [Item 2]: [Previous Value] → [New Value ▼] ⚠️      │
│   └── [Reason for flag / suggestion]              │
│                                                    │
│ [Apply Changes] [View Full Detail] [Save Template] │
└────────────────────────────────────────────────────┘
```

---

### Pattern 4: Inline Exception Handling

When exceptions occur during a workflow, handle them inline rather than requiring separate navigation.

#### Structure:
```
⚠️ [Exception Title]
[Description of what's wrong]

Options:
• [Resolve Now] — Opens inline resolution form
• [Override with Reason] — Proceed with logged justification
• [Defer] — Add to task list for later
• [Cancel] — Abandon current action
```

---

### Pattern 5: Contextual Help & Guidance

Provide help where users need it, not in separate documentation.

#### Implementation:
- Tooltip hints on form fields
- "Learn more" expandable sections
- Inline validation with helpful messages
- Suggested next actions after completion

---

## UI Component Patterns

### Exception Card

```html
<div class="exception-card exception-[severity]">
  <div class="exception-header">
    <span class="exception-icon">[Icon]</span>
    <span class="exception-title">[Title]</span>
    <span class="exception-badge">[Category]</span>
  </div>
  <div class="exception-body">
    <p class="exception-description">[Description with context]</p>
    <div class="exception-metrics">
      <span>Current: [X]</span>
      <span>Threshold: [Y]</span>
      <span>Impact: [Z]</span>
    </div>
  </div>
  <div class="exception-actions">
    <button class="btn-primary">[Primary Action]</button>
    <button class="btn-secondary">[Secondary Action]</button>
    <button class="btn-link">[View Details]</button>
  </div>
</div>
```

**Severity levels:** `critical` (red), `warning` (amber), `info` (blue)

---

### Metric Card (Context-Aware)

```html
<div class="metric-card">
  <div class="metric-header">
    <span class="metric-icon">[Icon]</span>
    <span class="metric-title">[Title]</span>
  </div>
  <div class="metric-body">
    <div class="metric-value">[Value]</div>
    <div class="metric-label">[Unit/Label]</div>
    <div class="metric-progress">
      <div class="progress-bar" style="width: [X]%"></div>
    </div>
    <div class="metric-comparison">
      <span class="trend trend-[up/down]">[+/-X]%</span>
      <span class="period">vs. [comparison]</span>
    </div>
  </div>
  <div class="metric-footer" *ngIf="hasExceptions">
    <a href="#">[N] items need attention</a>
  </div>
</div>
```

---

### Quick Action Button

```html
<button class="quick-action" onclick="openQuickActionModal('[action-type]')">
  <span class="quick-action-icon">[Icon]</span>
  <span class="quick-action-label">[Action Name]</span>
</button>
```

Quick actions open focused modals, not full page navigation.

---

### Workflow Task Item

```html
<div class="workflow-task task-[status]">
  <span class="task-checkbox">[☑️/⬜]</span>
  <span class="task-time">[Time]</span>
  <span class="task-description">[Description]</span>
  <button class="task-action">[Action]</button>
</div>
```

**Statuses:** `completed`, `pending`, `overdue`, `in-progress`

---

## Anomaly Detection Framework

### Defining Anomalies

For each key metric in your system, define:

| Metric | Normal Range | Warning Threshold | Critical Threshold | Detection Frequency |
|--------|-------------|-------------------|-------------------|---------------------|
| [Metric 1] | [X - Y] | [< A or > B] | [< C or > D] | [Hourly/Daily/Weekly] |

### Anomaly Data Structure

```sql
CREATE TABLE anomalies (
    id UUID PRIMARY KEY,
    entity_type VARCHAR(50),      -- What type of entity has the anomaly
    entity_id UUID,               -- Reference to the specific entity
    anomaly_type VARCHAR(100),    -- Category of anomaly
    severity VARCHAR(20),         -- 'critical', 'warning', 'info'
    title VARCHAR(255),           -- Human-readable title
    description TEXT,             -- Detailed explanation with context
    current_value DECIMAL,        -- The actual value
    threshold_value DECIMAL,      -- The threshold that was breached
    impact_description TEXT,      -- Business impact explanation
    suggested_actions JSONB,      -- Array of {action, label, url}
    detected_at TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by UUID,
    resolution_notes TEXT,
    is_active BOOLEAN DEFAULT TRUE
);
```

### Common Anomaly Types

| Category | Anomaly Types |
|----------|--------------|
| **Resource** | Shortage, surplus, utilization below target, utilization above capacity |
| **Schedule** | Overdue, at risk, conflict, gap |
| **Compliance** | Expiring, expired, violation, missing documentation |
| **Financial** | Over budget, under budget, cost spike, revenue drop |
| **Quality** | Below threshold, trend declining, outlier detected |
| **Inventory** | Low stock, overstock, expired, nearing expiry |

### Anomaly Detection Pattern

```javascript
async function detectAnomalies(entityType) {
  // 1. Get current metrics
  const metrics = await getCurrentMetrics(entityType);
  
  // 2. Get thresholds (from config or calculated)
  const thresholds = await getThresholds(entityType);
  
  // 3. Compare and identify anomalies
  const anomalies = [];
  
  for (const metric of metrics) {
    if (metric.value < thresholds.critical_low || 
        metric.value > thresholds.critical_high) {
      anomalies.push({
        severity: 'critical',
        metric: metric.name,
        value: metric.value,
        threshold: thresholds.critical_low || thresholds.critical_high
      });
    } else if (metric.value < thresholds.warning_low || 
               metric.value > thresholds.warning_high) {
      anomalies.push({
        severity: 'warning',
        // ...
      });
    }
  }
  
  // 4. Store/update anomalies
  await upsertAnomalies(anomalies);
  
  // 5. Trigger notifications if needed
  await processNotifications(anomalies);
}
```

---

## Workflow Design Guidelines

### Step 1: Map the Current Process

Document how users actually work today:
- What triggers the workflow?
- What steps do they take?
- What information do they need at each step?
- What decisions do they make?
- What are the outputs?

### Step 2: Identify Pain Points

- Where do users get stuck?
- Where do errors occur?
- What requires excessive navigation?
- What information is hard to find?
- What manual cross-referencing is required?

### Step 3: Design the Improved Flow

- Reduce steps where possible
- Pre-fill data where available
- Surface required information inline
- Validate early, not at the end
- Show downstream impacts

### Step 4: Define Automation Opportunities

- What can be auto-calculated?
- What records can be auto-created?
- What validations can be auto-performed?
- What notifications can be auto-sent?

### Workflow Documentation Template

```markdown
## Workflow: [Name]

### Trigger
[What initiates this workflow]

### Roles Involved
- [Role 1]: [Responsibility]
- [Role 2]: [Responsibility]

### Steps

| Step | Actor | Action | System Support | Data Required |
|------|-------|--------|---------------|---------------|
| 1 | [Role] | [Action] | [How system helps] | [What they need] |
| 2 | ... | ... | ... | ... |

### Integrations
- [Related workflow/module 1]
- [Related workflow/module 2]

### Exceptions
- [Exception 1]: [How handled]
- [Exception 2]: [How handled]

### Outputs
- [Record created/updated]
- [Notification sent]
- [Report generated]
```

---

## Mobile-First Field Interfaces

### Design Constraints

| Constraint | Implication |
|-----------|-------------|
| Small screen | One primary action per screen |
| Touch input | Minimum 44×44 px touch targets |
| Gloves/dirty hands | Large buttons, avoid typing |
| Bright sunlight | High contrast, avoid gradients |
| Intermittent connectivity | Offline-first, background sync |
| Time pressure | 3-tap maximum for any action |

### Mobile Screen Template

```
┌─────────────────────┐
│ [Context Bar]       │  <- Location, Team, Date
├─────────────────────┤
│                     │
│  [Primary Card]     │  <- Main action for current context
│  ┌───────────────┐  │
│  │ [Status/Info] │  │
│  │ [Big Button]  │  │
│  └───────────────┘  │
│                     │
│  [Secondary Card]   │  <- Secondary action
│  ┌───────────────┐  │
│  │               │  │
│  └───────────────┘  │
│                     │
│  [Report Issue]     │  <- Always accessible
│                     │
└─────────────────────┘
```

### Recommended Mobile Features

1. **Photo Capture** — Faster than typing, better evidence
2. **Voice Notes** — For detailed observations
3. **Barcode/QR Scanning** — Fast entity identification
4. **GPS Tagging** — Automatic location context
5. **Offline Queue** — Store actions, sync when connected
6. **Push Notifications** — For urgent exceptions only

---

## Notification & Escalation Framework

### Notification Tiers

| Tier | Urgency | Examples | Channels |
|------|---------|----------|----------|
| **Critical** | Action in <4 hours | Safety issue, compliance violation, system down | Push + SMS + In-app banner + Email |
| **High** | Action today | Resource shortage, deadline at risk, expiry imminent | In-app priority panel + Daily digest |
| **Medium** | Action this week | Upcoming deadline, approaching threshold | In-app "Due This Week" + Weekly summary |
| **Low** | Awareness only | Report ready, minor variance, FYI | Activity feed + Weekly digest |

### Escalation Rules

```
If: [Critical notification] is not acknowledged within [X hours]
Then: Escalate to [next role level]
And: Send via [additional channels]

Example:
  If: Critical exception not resolved within 4 hours
  Then: Escalate to manager
  If: Still not resolved within 8 hours
  Then: Escalate to director + SMS alert
```

### Notification Preferences

Allow users to configure:
- Which notification types they receive
- Which channels for each tier
- Quiet hours (no non-critical notifications)
- Delegate notifications when out of office

---

## Metrics & Dashboard Design

### Dashboard Hierarchy

1. **Exceptions Panel** (Top) — What needs attention NOW
2. **Key Metrics** — Operational pulse with threshold indicators
3. **Due Items** — Upcoming deadlines and scheduled work
4. **Quick Actions** — High-frequency task shortcuts
5. **Activity Feed** (Bottom) — Recent changes and audit trail

### Metric Selection Criteria

Include a metric on the dashboard if:
- ✓ It indicates operational health
- ✓ It has a clear target or threshold
- ✓ Users can take action to influence it
- ✓ It changes frequently enough to be worth monitoring

Exclude if:
- ✗ It's purely historical
- ✗ Users can't influence it
- ✗ It rarely changes
- ✗ It requires deep analysis to understand

### Threshold Configuration

Allow administrators to configure:
- Target values for each metric
- Warning thresholds
- Critical thresholds
- Comparison periods (vs. last week, last month, last year)
- Who gets notified at each threshold

---

## Checklist for Applying Principles

Use this checklist when designing or reviewing features:

### Exception-First Design
- [ ] Are exceptions surfaced prominently?
- [ ] Do exceptions include context and impact?
- [ ] Are action buttons available on exception cards?
- [ ] Are thresholds defined for detecting exceptions?

### Workflow Optimization
- [ ] Have we mapped the actual user workflow?
- [ ] Can the task be completed without module navigation?
- [ ] Are high-frequency tasks accessible via Quick Actions?
- [ ] Does the UI support copy/template patterns where applicable?

### Connected Information
- [ ] Are related records shown during data entry?
- [ ] Are downstream impacts visible before save?
- [ ] Are compliance checks embedded in the workflow?
- [ ] Does the action auto-create required related records?

### Proactive Intelligence
- [ ] Are trends calculated and displayed?
- [ ] Are projections available (not just history)?
- [ ] Is anomaly detection running on this data?
- [ ] Are suggestions provided based on patterns?

### Mobile Readiness (if applicable)
- [ ] Is there a simplified mobile view?
- [ ] Are touch targets large enough (44×44 px)?
- [ ] Does it work offline?
- [ ] Is photo capture available?

### Notification Design
- [ ] Is the notification tier appropriate?
- [ ] Are the right channels configured?
- [ ] Is escalation defined?
- [ ] Can users configure preferences?

---

## Quick Reference Card

### The 5 Questions to Ask

1. **What could go wrong?** → Build exception detection
2. **What do users do every day?** → Build workflow views
3. **What impacts what?** → Build connected workflows
4. **What's coming next?** → Build projections & predictions
5. **What takes too many clicks?** → Build quick actions

### The 3 Never Rules

1. **Never** make users hunt for problems — surface exceptions
2. **Never** require navigation for high-frequency tasks — use modals/quick actions
3. **Never** show data without context — always include targets and trends

### The Signature Experience

> "The system tells me what needs attention, guides me through my work, and prevents me from making mistakes — before I even know there's a problem."

---

*Version 1.0 | Last Updated: December 2025*

