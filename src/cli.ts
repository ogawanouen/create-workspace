#!/usr/bin/env node

import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const help = `Usage: create-workspace [options]

Create monorepos and workspaces.
Workspace generation is not implemented yet.

Options:
  -h, --help     Show this help message
  -v, --version  Show the version
`;

try {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(help);
  } else if (values.version) {
    console.log(packageJson.version);
  } else {
    console.log(help);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-workspace: ${message}`);
  console.error("Run create-workspace --help for usage.");
  process.exitCode = 1;
}
