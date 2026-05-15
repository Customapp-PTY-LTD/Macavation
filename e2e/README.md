# E2E tests (legacy location)

End-to-end tests and screenshot capture live under **[`Playwright Tests/`](../Playwright%20Tests/README.md)** (QA Blueprint).

## Run tests

```bash
cd "Playwright Tests"
npm install
npm test
```

## Regenerate help screenshots

After UI changes that affect help topics:

```bash
cd "Playwright Tests"
npm run capture-user-guide
```

Requires `.env.e2e` in `Playwright Tests/` (copy from `.env.e2e.example` if present). Do not commit `.env.e2e` or `test-results/`.
