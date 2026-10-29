import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export const cli = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
export const keys = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  escape: "\x1b",
  cancel: "\x03",
};
export const prompts = {
  destination: "追加先を選択してください",
  template: "アプリを選択してください",
  directory: "ディレクトリー名を入力してください",
  package: "パッケージ名を入力してください",
  confirm: "このコマンドを実行してよろしいですか？",
};

function answerKeys(prompt, answer) {
  if (answer === keys.cancel || answer === keys.escape) return answer;
  if (prompt === prompts.confirm) {
    if (answer.startsWith("\x1b")) return `${answer}\r`;
    return /^(y|yes)$/i.test(answer) ? `${keys.left}\r` : "\r";
  }
  if (
    prompt === prompts.directory ||
    prompt === prompts.package ||
    prompt === "プロジェクト名を入力してください"
  ) {
    return `\x15${answer}\r`;
  }
  return `${answer}\r`;
}

export async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function fixture(
  t,
  workspace = "# workspace comment\npackages:\n  - apps/* # apps comment\ncatalog:\n  typescript: ^7.0.0\nallowBuilds:\n  lefthook: true # build comment\n",
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "create-workspace-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true }),
  );
  if (workspace !== null)
    await write(join(root, "pnpm-workspace.yaml"), workspace);
  return root;
}

export function interact(
  cwd,
  answers,
  { env = {}, args = [], timeout = 20_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let next = 0;
    let offset = 0;
    let responseTimer;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`CLI timed out at answer ${next}:\n${output.slice(-6000)}`),
      );
    }, timeout);
    child.stdin.on("error", () => {});
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (data) => {
        output += stripVTControlCharacters(data.toString());
        clearTimeout(responseTimer);
        // Clack redraws during typing and validation. Wait for the completed
        // frame before responding so repeated text prompts can be retried.
        responseTimer = setTimeout(() => {
          if (next >= answers.length) return;
          const [prompt, answer] = answers[next];
          if (!output.includes(prompt, offset)) return;
          offset = output.length;
          next++;
          child.stdin.write(answerKeys(prompt, answer));
        }, 30);
      });
    }
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(responseTimer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(responseTimer);
      resolve({ code, signal, output, answered: next });
    });
  });
}

export function projectAnswers(
  destination,
  template,
  name,
  packageName,
  confirm = "yes",
) {
  return [
    [prompts.destination, destination === "apps" ? "" : keys.down],
    ...(destination === "apps"
      ? [[prompts.template, keys.down.repeat(Number(template) - 1)]]
      : []),
    [prompts.directory, name],
    [prompts.package, packageName],
    [prompts.confirm, confirm],
  ];
}

export async function mockPnpm(root) {
  const bin = join(root, "bin");
  await write(
    join(bin, "pnpm"),
    `#!${process.execPath}
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
const args = process.argv.slice(2);
await appendFile(process.env.MOCK_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
const install = args[0] === "install";
if (process.env.MOCK_FAIL === (install ? "install" : "generate")) process.exit(7);
if (process.env.MOCK_SIGNAL && !install) process.kill(process.pid, "SIGTERM");
if (!install) {
  if (process.env.MOCK_HANDOFF) {
    const input = createInterface({input: process.stdin, output: process.stdout});
    const answer = await input.question("CHILD_INPUT: ");
    input.close();
    if (answer !== "child answer") process.exit(9);
    console.log("CHILD_INPUT_OK");
  }
  const target = resolve(args[2] ?? "default-workspace");
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, "package.json"), JSON.stringify({name: "generated", scripts: {build: "generated build"}, custom: {preserved: true}}));
  if (args[1].startsWith("create-fate")) {
    await writeFile(resolve(target, "package.json"), JSON.stringify({name: "generated", dependencies: {}, devDependencies: {vite: "catalog:"}, scripts: {build: "generated build"}, custom: {preserved: true}}));
    await writeFile(resolve(target, "pnpm-workspace.yaml"), "catalog:\\n  vite: npm:@voidzero-dev/vite-plus-core@1.4.0\\n");
    await mkdir(resolve(target, "pages"));
    await mkdir(resolve(target, "src"));
    await writeFile(resolve(target, "pages/layout.tsx"), "import Stack from '@nkzw/stack';\\n<LocaleContext></LocaleContext>");
    await writeFile(resolve(target, "pages/index.tsx"), "import Stack, { VStack } from '@nkzw/stack';\\n<Section gap={32}>");
    await writeFile(resolve(target, "src/App.css"), "@import 'tailwindcss';");
  }
  if (args[1].startsWith("create-cloudflare")) {
    for (const path of ["pnpm-workspace.yaml", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) await writeFile(resolve(target, path), "generated");
    await mkdir(resolve(target, "node_modules"));
  }
  if (args[1].startsWith("create-turbo")) await writeFile(resolve(target, "biome.json.template"), "{}");
}
`,
  );
  const { chmod } = await import("node:fs/promises");
  await chmod(join(bin, "pnpm"), 0o755);
  return {
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_LOG: join(root, "calls.jsonl"),
  };
}

export async function calls(root) {
  try {
    return (await readFile(join(root, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
