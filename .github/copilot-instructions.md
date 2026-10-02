# Copilot instructions for this repository

This workspace currently appears to be empty: no application source, no `README`, and no existing AI agent instructions were found under the standard project conventions. Treat this as a placeholder file until the actual project is added.

## Working assumptions
- Start by confirming the real project structure before editing. The repo root may be empty now, but a full app will likely appear later.
- Prefer minimal, targeted changes over broad refactors.
- Match the conventions of the existing project once files are present; do not introduce new frameworks or architectural patterns unless the codebase already uses them.
- If a `README.md`, `AGENT.md`, `AGENTS.md`, or similar file appears, read it before implementing new features.

## Repository-first workflow
- Check the repo root for the actual app entry points, config files, and package manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `.csproj`, etc.) before making changes.
- Preserve the existing module boundaries, naming conventions, and import structure.
- Favor edits near the affected feature or component instead of creating parallel implementations.

## Validation
- Run the smallest relevant verification command for the changed scope, not a full repo-wide suite unless that is the project’s standard workflow.
- For example, prefer the app’s local test command or a package-level check over broad validation.
- If no project commands are available yet, do not invent build steps; document the missing setup and keep changes conservative.

## Guidance for future project content
- Keep a single source of truth for configuration and environment-specific settings.
- Reuse existing abstractions and service boundaries instead of duplicating logic.
- When adding new behavior, follow the same patterns as adjacent code: file layout, state management, dependency injection, and naming.
- Keep comments focused on why a design exists, not what obvious code does.

## Practical AI-agent rule
When the project becomes populated, the agent should first map the architecture and then implement the smallest change that fits the established conventions. If the codebase is not yet present, avoid speculative architecture decisions and preserve the repo in a clean, discoverable state.
