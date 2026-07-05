## 2026-07-05 - [Avoiding generated files and dependency noise]
**Learning:** Manual changes to generated files (like '.gen.ts') are lost on regeneration. Additionally, 'npm install' or 'npm build' can sometimes introduce unintended transitive dependency changes in 'package-lock.json' that bloat PRs.
**Action:** Always verify if a file is generated before editing. Use 'git checkout' to revert unintended lockfile or generated file changes before submission.
