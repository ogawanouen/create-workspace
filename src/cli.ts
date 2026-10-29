#!/usr/bin/env node

import { parseArgs } from "node:util";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import packageJson from "../package.json" with { type: "json" };

const help = `Usage: create-workspace [options]

Create monorepos and workspaces.
Choose a template and print the command to create a workspace.

When prompted, press Enter or enter 1 for the default template, or enter 2 for
the Cloudflare template.

Options:
  -h, --help     Show this help message
  -v, --version  Show the version
`;

async function findTurboConfig(startDirectory: string): Promise<boolean> {
  let directory = resolve(startDirectory);

  while (true) {
    try {
      await access(resolve(directory, "turbo.json"));
      return true;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return false;
      directory = parent;
    }
  }
}

async function selectTemplate(): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout });
  const lines = readline[Symbol.asyncIterator]();
  try {
    while (true) {
      stdout.write("テンプレートを選択してください (1: デフォルト, 2: Cloudflare) [1]: ");
      const { value, done } = await lines.next();
      if (done) throw new Error("入力を受け取れませんでした。");

      const answer = value.trim();
      if (answer === "" || answer === "1") {
        console.log("pnpm dlx create-turbo@latest");
        return;
      }
      if (answer === "2") {
        console.log(
          "pnpm dlx create-turbo@latest --example https://github.com/bimsina/vite-react-cf-starter",
        );
        return;
      }
      console.log("1 または 2 を入力してください。");
    }
  } finally {
    readline.close();
  }
}

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
    if (await findTurboConfig(process.cwd())) {
      console.log("WorkspaceはTurborepoで管理されています。");
    } else {
      await selectTemplate();
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-workspace: ${message}`);
  console.error("Run create-workspace --help for usage.");
  process.exitCode = 1;
}
