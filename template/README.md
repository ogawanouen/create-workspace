# Cloudflare Worker Turborepo

This workspace contains a minimal TypeScript Cloudflare Worker in `apps/worker`.

## Getting started

```sh
pnpm install
pnpm dev
```

The Worker responds with `Hello World!` at <http://localhost:8787>. To deploy it,
run `pnpm --filter @repo/worker exec wrangler deploy` after authenticating with
Cloudflare.

Run `pnpm check` to format and lint the workspace, or `pnpm typecheck` to check
the Worker types.
