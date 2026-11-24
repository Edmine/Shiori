# Contributing to Shiori

Thank you for your interest in contributing to **Shiori**! This guide covers local setup, code conventions, and pull request expectations.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) 1.3+
- Node.js 20+
- Windows, macOS, or Linux

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Edmine/Shiori.git
   cd Shiori
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. (Optional) Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Run in development mode:
   ```bash
   bun run electron:dev
   ```

## Development Workflow

### Branch Naming

- `feat/...` — New features
- `fix/...` — Bug fixes
- `refactor/...` — Code refactoring
- `docs/...` — Documentation updates

### Verification Before Opening a PR

Run type checks and CI validation locally:

```bash
bun run typecheck:electron
bun run validate:ci
```

If you add or modify UI strings, ensure both `en.json` and `zh-Hans.json` (and any other locale files under `packages/shared/src/i18n/locales/`) stay in parity and sorted:

```bash
bun run sort-locales
bun run lint:i18n:parity
```

## Pull Request Guidelines

- Keep PRs focused and reviewable.
- Describe **what** changed and **why**.
- Attach screenshots or short recordings for UI/UX changes.
- Do not include personal credentials, local paths, or build artifacts.
