# Oxbridge Vocab Challenge

The student-facing vocabulary practice application for **K S Lo English**. It provides four-option sentence-cloze exercises for the Oxford 3000, Oxford 5000, and C2 Proficiency collections using approved, minimised release data.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm validate:release
pnpm test
pnpm check
pnpm build:pages
```

GitHub Actions publishes the validated static build to GitHub Pages from `main`. The public repository contains only the application, self-contained visual assets, and production-safe release JSON. Private authoring data, provenance, approvals, candidates, review evidence, and manifests are excluded.
