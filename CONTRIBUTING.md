# Contributing to Harni

Thank you for your interest in contributing to Harni! We welcome bug reports, feature requests, documentation improvements, and code contributions.

## Code of Conduct

Please treat all community members with respect, patience, and professional courtesy.

## Development Setup

### Prerequisites
- **Node.js**: >= 20.0.0
- **pnpm**: >= 9.0.0
- **Git**

### Installation

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/harni.git
   cd harni
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start development servers:
   ```bash
   pnpm dev
   ```
   This will concurrently start the backend server on port 3001 and the web client on port 3000.

## Monorepo Structure

- `packages/types`: Shared TypeScript interfaces and WebSocket schemas.
- `packages/agent-core`: Headless agent engine (task loop, tools, subagents, auto-testing, syntax diagnostics, MCP client).
- `apps/server`: Node.js backend server (HTTP, WebSocket gateway, PTY terminal, SQLite AES-256-GCM vault).
- `apps/web`: React 19 + Vite web interface with Monaco Editor and Xterm.js.
- `apps/desktop`: Electron desktop packaging wrapper.

## Quality Standards

Before submitting a Pull Request, please ensure all checks pass:

```bash
# Run type checking across all packages
pnpm typecheck

# Run linter
pnpm lint

# Run all automated tests
pnpm test
```

## Pull Request Guidelines

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit your changes with clear, descriptive commit messages (Conventional Commits preferred).
3. Ensure all tests pass and add new unit/integration tests for your changes where applicable.
4. Open a Pull Request against the `main` branch with a concise summary of changes and testing steps.
