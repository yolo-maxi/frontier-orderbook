# Frontier Skills

The canonical agent-facing contract guide is now [`skill.md`](./skill.md).

Use `skill.md` for:

- market creation
- maker flows
- taker flows
- fee behavior
- delegation
- positive and negative examples
- deploy smoke-test checklist

This compatibility file exists because earlier deploy docs referenced `skills.md`.

## Packaged tooling

For AI agents and integrators, the deploy-facing tooling now also includes:

- [`skill/`](./skill) — a packaged Claude Agent Skill (`SKILL.md` + reference
  files: deploy path, maker/taker/delegation templates, safety checklist, error
  recovery) derived from `skill.md`.
- [`docs/`](./docs) — contract-interface reference, intent→contract decision
  tree, and JSON Schemas (`deployment-schema.json`, `position-schema.json`).
- [`sdk/`](./sdk) — `@frontier/sdk`, a typed TypeScript SDK.
- [`mcp/`](./mcp) — `@frontier/mcp`, a Model Context Protocol server.
