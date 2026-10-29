#!/usr/bin/env node

import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import { stdin } from "node:process";
import { parseArgs } from "node:util";
import {
  type CANCEL_SYMBOL,
  cancel,
  confirm,
  isCancel,
  select,
  text,
} from "@clack/prompts";
import packageJson from "../package.json" with { type: "json" };
import {
  type AppTemplate,
  type Destination,
  directoryError,
  findWorkspaceRoot,
  generatorArguments,
  integrateWorkspace,
  packageNameError,
  workspacePackageNames,
} from "./workspace.js";

const help = `Usage: create-workspace [options]

Create monorepos, or add apps and packages to an existing pnpm/Turborepo workspace.

Inside a workspace (including subdirectories): choose apps or packages, then
React Router, simple Workers, or Hono for apps. Enter a directory name and a
package name (including @scope/name), confirm generation and root pnpm install.
Use the arrow keys to select an option and Enter to confirm.
Outside a workspace: choose the default template or Cloudflare.
With no options, start the interactive flow.

Options:
  -h, --help     Show this help message
  -v, --version  Show the version
`;

class PromptCancelled extends Error {}

async function prompt<T>(
  result: Promise<T | typeof CANCEL_SYMBOL>,
): Promise<T> {
  const value = await result;
  if (isCancel(value)) throw new PromptCancelled();
  return value;
}

async function selectTemplate(): Promise<void> {
  const template = await prompt(
    select({
      message: "テンプレートを選択してください",
      options: [
        { value: "default", label: "デフォルト" },
        { value: "cloudflare", label: "Cloudflare" },
      ],
    }),
  );
  if (template === "default") {
    await confirmAndRun(["dlx", "create-turbo@latest"]);
    return;
  }
  const name = (
    await prompt(
      text({
        message: "プロジェクト名を入力してください",
        validate(value) {
          const name = (value ?? "").trim();
          if (!name) return "プロジェクト名を入力してください。";
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
            return "プロジェクト名には英数字、ドット、ハイフン、アンダースコアを使用してください。";
          }
        },
      }),
    )
  ).trim();
  const templateUrl =
    process.env.CREATE_WORKSPACE_TEMPLATE_URL ??
    "https://github.com/ogawanouen/create-workspace/tree/main/template";
  const created = await confirmAndRun([
    "dlx",
    "create-turbo@latest",
    name,
    "--example",
    templateUrl,
    "--package-manager",
    "pnpm",
  ]);
  if (created) {
    await rename(
      resolve(process.cwd(), name, "biome.json.template"),
      resolve(process.cwd(), name, "biome.json"),
    );
  }
}

async function addWorkspaceProject(root: string): Promise<void> {
  // Validate workspace configuration before offering to run a generator.
  const packageNames = await workspacePackageNames(root);
  console.log(`Workspaceルート: ${root}`);
  const destination = await prompt(
    select<Destination>({
      message: "追加先を選択してください",
      options: [
        { value: "apps", label: "apps" },
        { value: "packages", label: "packages" },
      ],
    }),
  );
  const template =
    destination === "apps"
      ? await prompt(
          select<AppTemplate>({
            message: "アプリを選択してください",
            options: [
              { value: "react-router", label: "React Router" },
              { value: "hello-world", label: "シンプルなWorkers" },
              { value: "hono", label: "Hono" },
            ],
          }),
        )
      : undefined;
  const name = (
    await prompt(
      text({
        message: "ディレクトリー名を入力してください",
        validate: (value) =>
          directoryError(root, destination, (value ?? "").trim()),
      }),
    )
  ).trim();
  const packageName = (
    await prompt(
      text({
        message: "パッケージ名を入力してください",
        validate(value) {
          const name = (value ?? "").trim();
          return (
            packageNameError(name) ??
            (packageNames.has(name)
              ? `パッケージ名は既に使用されています: ${name}`
              : undefined)
          );
        },
      }),
    )
  ).trim();
  const target = resolve(root, destination, name);
  console.log(`作成先: ${target}`);
  console.log(`パッケージ名: ${packageName}`);
  console.log(`自動インストール: ${root} で pnpm install`);
  let stage = "生成";
  try {
    const created = await confirmAndRun(
      generatorArguments(destination, name, template),
      root,
      async () => {
        const error = await directoryError(root, destination, name);
        if (error) throw new Error(error);
        if ((await workspacePackageNames(root)).has(packageName)) {
          throw new Error(`パッケージ名は既に使用されています: ${packageName}`);
        }
      },
    );
    if (!created) return;
    stage = "workspaceへの統合";
    await integrateWorkspace(root, target, packageName, destination === "apps");
    stage = "ルートでの pnpm install";
    await runPnpm(["install"], root);
    console.log(`追加が完了しました: ${target} (${packageName})`);
  } catch (error) {
    if (error instanceof PromptCancelled) throw error;
    throw new Error(
      `${stage}に失敗しました。生成先: ${target}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

async function confirmAndRun(
  arguments_: string[],
  cwd = process.cwd(),
  beforeRun?: () => Promise<void>,
): Promise<boolean> {
  const command = `pnpm ${arguments_.map(shellQuote).join(" ")}`;
  console.log(`実行するコマンド: ${command}`);
  const approved = await prompt(
    confirm({
      message: "このコマンドを実行してよろしいですか？",
      active: "実行する",
      inactive: "キャンセル",
      initialValue: false,
    }),
  );

  if (!approved) {
    console.log("実行をキャンセルしました。");
    return false;
  }

  await beforeRun?.();
  await runPnpm(arguments_, cwd);
  return true;
}

async function runPnpm(arguments_: string[], cwd: string): Promise<void> {
  // Clack closes each prompt and restores terminal mode before resolving.
  // Pause stdin so the interactive child has exclusive ownership of fd 0.
  stdin.pause();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", arguments_, { cwd, stdio: "inherit" });
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
    const root = await findWorkspaceRoot(process.cwd());
    if (root) {
      await addWorkspaceProject(root);
    } else {
      await selectTemplate();
    }
  }
} catch (error) {
  if (error instanceof PromptCancelled) {
    cancel("実行をキャンセルしました。");
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`create-workspace: ${message}`);
    console.error("Run create-workspace --help for usage.");
    process.exitCode = 1;
  }
} finally {
  stdin.pause();
  stdin.unref?.();
}
