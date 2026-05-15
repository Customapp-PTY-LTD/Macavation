# Cursor Rule: Auto-Update User Guide on Commit

A lightweight pattern that makes Cursor AI automatically keep your user-facing documentation in sync with your codebase — on every commit, across any project.

## Macavation (this repo)

| Purpose | Path |
|--------|------|
| In-app help topics (Help button, hash links) | `WebPortal/help/index.html` |
| Module manual + route appendix | `WebPortal/help/user-manual.html` |
| Standalone overview (PDF-style) | `WebPortal/assets/docs/user-guide.html` |
| Help links on screens | `node scripts/apply_user_guide_help_links.mjs` |
| Screenshot-backed TOC (optional legacy) | `docs/user-guide.html` |
| Regenerate help PNGs | `cd "Playwright Tests" && npm run capture-user-guide` → `WebPortal/help/assets/screenshots/` |

Authoritative Cursor rules: `.cursor/rules/user-guide-update.mdc` and `user-guide-on-webportal-changes.mdc`.

---

## The Problem It Solves

Documentation drifts. Developers build features, commit code, and the user guide gets forgotten. By the time someone notices, the docs are weeks out of date and nobody remembers what changed.

This pattern enforces documentation hygiene at the **commit level** by giving the AI a rule it cannot ignore.

---

## How It Works

Cursor supports project-level AI rules stored in `.cursor/rules/`. Any rule file with `alwaysApply: true` is automatically injected into the AI's context on **every conversation** in that workspace.

When you ask the AI to build a feature and commit it, the rule fires and the AI:
1. Updates the user guide HTML before creating the commit
2. Includes the documentation update in the same commit as the code
3. Provides an anchor ID so in-app help buttons can deep-link directly to the relevant section

When you push to your dev/production branch, the updated guide ships with the code — automatically.

No CI pipeline. No scripts. No separate documentation PRs.

---

## Setup Guide

### Step 1 — Create the rules directory

In the root of your project:

```
.cursor/
└── rules/
    └── user-guide-update.mdc
```

### Step 2 — Create the rule file

Create `.cursor/rules/user-guide-update.mdc` with the following content:

```markdown
---
description: Remind developers to update the user guide when committing a new feature
alwaysApply: true
---

# User Guide Update Reminder

When creating a Git commit that introduces or changes a user-facing feature, **always update the Macavation help surfaces** (`WebPortal/help/index.html`, and related manual/overview docs as needed) before committing.

Use the following checklist to add the new section:

\```
Feature name:         [e.g. Dashboard Widgets]
Anchor ID:            [e.g. dashboard-widgets]
App location:         [e.g. Home → Dashboard]
Summary:              [1–2 sentences on what the feature does and why]
Diagrams:             [flow diagram / screenshot callout / none]
Help button location: [file path, e.g. modules/dashboard/html/dashboard.html]
\```

Add a corresponding section in `WebPortal/help/index.html` with an `id` matching the anchor ID so the in-app help button can link directly to it (`help/index.html#anchor-id`).
```

> **Note:** Remove the backslashes before the triple backticks — they are only there to prevent rendering issues in this guide.

### Step 3 — Create your user guide file

If you don't already have one, add a section to `WebPortal/help/index.html`. A minimal HTML pattern:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>User Guide</title>
</head>
<body>

  <h1>User Guide</h1>

  <!-- Each feature section gets a unique id -->
  <section id="dashboard-widgets">
    <h2>Dashboard Widgets</h2>
    <p>Located at: Home → Dashboard</p>
    <p>Description of the feature...</p>
  </section>

</body>
</html>
```

### Step 4 — Add an in-app help button (optional but recommended)

In any module HTML file, add a help button that deep-links to the relevant section:

```html
<a href="help/index.html#dashboard-widgets" target="_blank" class="btn btn-sm btn-outline-secondary macavation-help-link">
  <i data-feather="help-circle"></i> Help
</a>
```

The anchor `#dashboard-widgets` matches the `id` on the section in the guide — so clicking Help scrolls straight to the right part of the documentation.

---

## Adapting for Your Stack

The rule file above uses an HTML user guide, but you can point it at any format:

| Format | Change the guide path to... |
|--------|--------------------------------------|
| Macavation in-app help | `WebPortal/help/index.html` |
| Markdown wiki | `docs/USER_GUIDE.md` |
| Notion / Confluence | The URL of the page (AI will remind you to update it manually) |
| Storybook | `docs/stories/` directory |
| README | `README.md` |

You can also maintain **multiple rules** — one per documentation concern:

```
.cursor/rules/
├── user-guide-update.mdc       ← user-facing features
├── api-docs-update.mdc         ← API endpoint changes
├── migration-log-update.mdc    ← database migrations
└── changelog-update.mdc        ← public changelog
```

---

## Tips for Writing Effective Rules

| Tip | Why it matters |
|-----|---------------|
| Use `alwaysApply: true` | Ensures the rule fires on every conversation, not just when the AI guesses it's relevant |
| Be specific about the trigger | "When creating a Git commit that introduces or changes a user-facing feature" is better than "update the docs" |
| Include a checklist | Structured prompts produce consistent, scannable documentation sections |
| Include the anchor ID convention | Enables deep-linking from in-app help buttons without extra coordination |
| Keep the rule short | AI rule files work best when they are focused and scannable — under 30 lines |

---

## Example Rule Files for Other Concerns

### API Documentation Rule

```markdown
---
description: Keep API docs in sync with endpoint changes
alwaysApply: true
---

# API Docs Update Reminder

When adding or modifying an API endpoint, **always update `docs/api-reference.md`** before committing.

Include:
- Endpoint path and HTTP method
- Required and optional parameters
- Example request and response
- Any authentication requirements
```

### Database Migration Log Rule

```markdown
---
description: Log all database migrations before committing
alwaysApply: true
---

# Migration Log Reminder

When creating a database migration file, **always add an entry to `docs/MIGRATION_LOG.md`** before committing.

Include:
- Migration number and filename
- What changed (tables, columns, functions)
- Whether it is reversible
- Any data impact or required seed steps
```

---

## Frequently Asked Questions

**Does this require any plugins or extensions?**
No. It only requires Cursor IDE. The `.cursor/rules/` directory is part of the Cursor specification.

**Will this work if a developer doesn't use Cursor?**
The rule only fires inside Cursor. Developers using other editors won't be prompted. You can mitigate this with a pre-commit hook that checks whether the user guide was modified alongside feature files.

**Can I use this with GitHub Copilot or other AI tools?**
Not directly. Other tools have their own conventions (e.g. `.github/copilot-instructions.md` for Copilot). The same principle applies — put the instruction where the AI reads it.

**What if the AI doesn't follow the rule?**
Strengthen the rule language. Replace "always update" with "you MUST update ... before creating the commit. Do not proceed with the commit until this is done." More directive language produces more reliable compliance.

**Does Cursor share `.cursor/rules/` with the team?**
Yes — the `.cursor/` directory lives inside the repo and is committed to version control. Every developer who clones the repo and opens it in Cursor gets the same rules automatically.

---

## Summary

| What | Where |
|------|-------|
| Rule file | `.cursor/rules/user-guide-update.mdc` |
| Trigger | Every Cursor conversation in the project |
| User guide (Macavation) | `WebPortal/help/index.html` (+ `user-manual.html`, `assets/docs/user-guide.html` as needed) |
| Deep-link pattern | `<section id="anchor-id">` + `help/index.html#anchor-id` on Help links |
| Team sharing | Commit `.cursor/rules/` to the repo — all teammates inherit it |
