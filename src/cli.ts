#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const help = `Usage: create-workspace [options]

Create monorepos and workspaces.
Choose a template, confirm the command, and create a workspace.

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
  try {
    while (true) {
      const answer = (
        await readline.question(
          "テンプレートを選択してください (1: デフォルト, 2: Cloudflare) [1]: ",
        )
      ).trim();
      if (answer === "" || answer === "1") {
        await confirmAndRun(["dlx", "create-turbo@latest"], readline);
        return;
      }
      if (answer === "2") {
        const name = (
          await readline.question("プロジェクト名を入力してください: ")
        ).trim();
        if (name === "") {
          console.log("プロジェクト名を入力してください。");
          continue;
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          console.log(
            "プロジェクト名には英数字、ドット、ハイフン、アンダースコアを使用してください。",
          );
          continue;
        }
        const templateUrl =
          process.env.CREATE_WORKSPACE_TEMPLATE_URL ??
          "https://github.com/ogawanouen/create-workspace/tree/main/template";
        const created = await confirmAndRun(
          [
            "dlx",
            "create-turbo@latest",
            name,
            "--example",
            templateUrl,
            "--package-manager",
            "pnpm",
          ],
          readline,
        );
        if (created) {
          await rename(
            resolve(process.cwd(), name, "biome.json.template"),
            resolve(process.cwd(), name, "biome.json"),
          );
        }
        return;
      }
      console.log("1 または 2 を入力してください。");
    }
  } finally {
    readline.close();
    stdin.pause();
    stdin.unref();
    stdin.destroy();
  }
}

function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

async function confirmAndRun(
  arguments_: string[],
  readline: ReturnType<typeof createInterface>,
): Promise<boolean> {
  const command = `pnpm ${arguments_.map(shellQuote).join(" ")}`;
  console.log(`実行するコマンド: ${command}`);
  const answer = await readline.question(
    "このコマンドを実行してよろしいですか？ (y/N): ",
  );

  if (!/^(y|yes)$/i.test(answer.trim())) {
    console.log("実行をキャンセルしました。");
    return false;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", arguments_, { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            signal
              ? `コマンドがシグナル ${signal} で終了しました。`
              : `コマンドが終了コード ${code ?? "不明"} で終了しました。`,
          ),
        );
      }
    });
  });
  return true;
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
