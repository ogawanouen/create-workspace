import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
  calls,
  cli,
  fixture,
  interact,
  keys,
  mockPnpm,
  projectAnswers,
  prompts,
  write,
} from "./helpers.mjs";

for (const [destination, template, selector] of [
  ["packages", undefined, ["--template", "minimal"]],
  ["apps", "1", ["--framework", "react-router"]],
  ["apps", "2", ["--type", "hello-world"]],
  ["apps", "3", ["--framework", "hono"]],
]) {
  test(`generates and integrates ${destination}/${template ?? "tsdown"} from a subdirectory`, async (t) => {
    const root = await fixture(t);
    const cwd = join(root, "apps", "existing", "src");
    await mkdir(cwd, { recursive: true });
    // A project-local turbo.json must not hide the pnpm workspace root.
    await write(join(cwd, "turbo.json"), "{}");
    const result = await interact(
      cwd,
      projectAnswers(
        destination,
        template,
        "new-project",
        "@example/new-project",
      ),
      { env: await mockPnpm(root) },
    );
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /追加が完了しました/);
    const commands = await calls(root);
    assert.deepEqual(
      commands.map(({ cwd: directory }) => directory),
      [root, root],
    );
    assert.deepEqual(commands[0].args.slice(0, 5), [
      "dlx",
      destination === "apps"
        ? "create-cloudflare@latest"
        : "create-tsdown@latest",
      `${destination}/new-project`,
      ...selector,
    ]);
    if (destination === "apps") {
      assert.deepEqual(commands[0].args.slice(5), [
        "--platform",
        "workers",
        "--lang",
        "ts",
        "--no-deploy",
        "--no-git",
        "--accept-defaults",
      ]);
    }
    assert.deepEqual(commands[1].args, ["install"]);
    const target = join(root, destination, "new-project");
    const manifest = JSON.parse(
      await readFile(join(target, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, "@example/new-project");
    assert.deepEqual(manifest.scripts, { build: "generated build" });
    assert.deepEqual(manifest.custom, { preserved: true });
    const source = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
    for (const comment of [
      "# workspace comment",
      "# apps comment",
      "# build comment",
    ])
      assert.ok(source.includes(comment));
    const workspace = parse(source);
    assert.deepEqual(workspace.packages, ["apps/*", "packages/*"]);
    assert.deepEqual(workspace.catalog, { typescript: "^7.0.0" });
    assert.deepEqual(
      workspace.allowBuilds,
      destination === "apps"
        ? { lefthook: true, esbuild: true, workerd: true }
        : { lefthook: true },
    );
    if (destination === "apps") {
      for (const file of [
        "pnpm-workspace.yaml",
        "pnpm-lock.yaml",
        "package-lock.json",
        "yarn.lock",
        "node_modules",
      ])
        await assert.rejects(access(join(target, file)));
    }
  });
}

test("generates Void with fate and Astryx and integrates it", async (t) => {
  const root = await fixture(t);
  const result = await interact(
    root,
    projectAnswers("apps", "4", "void-app", "@example/void-app"),
    { env: await mockPnpm(root) },
  );
  assert.equal(result.code, 0, result.output);
  const commands = await calls(root);
  assert.deepEqual(
    commands.map((call) => call.args),
    [
      [
        "dlx",
        "create-fate@latest",
        "apps/void-app",
        "--template",
        "void",
        "--framework",
        "react",
        "--no-setup",
      ],
      ["install"],
    ],
  );
  const target = join(root, "apps/void-app");
  const manifest = JSON.parse(
    await readFile(join(target, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@example/void-app");
  assert.equal(
    manifest.devDependencies.vite,
    "npm:@voidzero-dev/vite-plus-core@1.4.0",
  );
  assert.equal(manifest.dependencies["@astryxdesign/core"], "0.7.4");
  assert.match(
    await readFile(join(target, "pages/layout.tsx"), "utf8"),
    /neutralTheme/,
  );
  assert.match(
    await readFile(join(target, "src/App.css"), "utf8"),
    /astryx.css/,
  );
  await assert.rejects(access(join(target, "pnpm-workspace.yaml")));
});

test("Void generation can be cancelled or fail without installation", async (t) => {
  for (const mode of ["cancel", "fail"]) {
    const root = await fixture(t);
    const env = await mockPnpm(root);
    if (mode === "fail") env.MOCK_FAIL = "generate";
    const result = await interact(
      root,
      projectAnswers(
        "apps",
        "4",
        "app",
        "app",
        mode === "cancel" ? "no" : "yes",
      ),
      { env },
    );
    assert.equal(result.code, mode === "cancel" ? 0 : 1, result.output);
    assert.equal((await calls(root)).length, mode === "cancel" ? 0 : 1);
  }
});

test("falls back to turbo.json and creates the pnpm workspace file", async (t) => {
  const root = await fixture(t, null);
  await write(join(root, "turbo.json"), "{}");
  const result = await interact(
    root,
    projectAnswers("packages", undefined, "lib", "plain-package"),
    { env: await mockPnpm(root) },
  );
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(
    parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")).packages,
    ["apps/*", "packages/*"],
  );
});

test("retries invalid names, existing paths and duplicate workspace names", async (t) => {
  const root = await fixture(
    t,
    "packages:\n  - 'modules/**'\n  - '!modules/excluded'\n",
  );
  await write(
    join(root, "modules", "existing", "package.json"),
    '{"name":"@example/taken"}',
  );
  await write(
    join(root, "modules", "excluded", "package.json"),
    '{"name":"@example/allowed"}',
  );
  await mkdir(join(root, "apps", "exists"), { recursive: true });
  await symlink("missing", join(root, "apps", "dangling"));
  const answers = [
    [prompts.destination, ""],
    [prompts.template, keys.down],
    ...[
      "",
      "../escape",
      "@scope/name",
      "Uppercase",
      "bad_name",
      "-bad",
      "bad-",
      "a".repeat(59),
      "exists",
      "dangling",
      "valid",
    ].map((name) => [prompts.directory, name]),
    ...[
      "",
      "@bad",
      "UPPER",
      "bad name",
      "root",
      "@example/taken",
      "@example/allowed",
    ].map((name) => [prompts.package, name]),
    [prompts.confirm, "y"],
  ];
  const result = await interact(root, answers, { env: await mockPnpm(root) });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.answered, answers.length);
  assert.equal((await calls(root)).length, 2);
  assert.equal(
    JSON.parse(
      await readFile(join(root, "apps", "valid", "package.json"), "utf8"),
    ).name,
    "@example/allowed",
  );
});

test("retries paths excluded by the workspace", async (t) => {
  const root = await fixture(
    t,
    "packages: ['packages/*', '!packages/excluded']\n",
  );
  const answers = projectAnswers("packages", undefined, "valid", "valid");
  answers.splice(1, 0, [prompts.directory, "excluded"]);
  const result = await interact(root, answers, { env: await mockPnpm(root) });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /除外設定に一致/);
});

test("rejects node_modules as a package directory", async (t) => {
  const root = await fixture(t);
  const answers = projectAnswers("packages", undefined, "valid", "valid");
  answers.splice(1, 0, [prompts.directory, "node_modules"]);
  const result = await interact(root, answers, { env: await mockPnpm(root) });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /node_modulesはworkspaceに登録できない/);
});

test("preserves permissions and adds only missing build approvals", async (t) => {
  const root = await fixture(
    t,
    "packages: ['apps/*']\npermissions:\n  esbuild:\n    build: false\n  workerd:\n    skills: false\nallowBuilds:\n  workerd: null\n",
  );
  const result = await interact(
    root,
    projectAnswers("apps", "2", "worker", "worker"),
    { env: await mockPnpm(root) },
  );
  assert.equal(result.code, 0, result.output);
  const workspace = parse(
    await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
  );
  assert.deepEqual(workspace.permissions, {
    esbuild: { build: false },
    workerd: { skills: false },
  });
  assert.deepEqual(workspace.allowBuilds, { workerd: true });
});

test("cancellation runs no command and changes no workspace files", async (t) => {
  const root = await fixture(t);
  const before = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
  const result = await interact(
    root,
    projectAnswers("packages", undefined, "lib", "lib", "n"),
    { env: await mockPnpm(root) },
  );
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /キャンセル/);
  assert.deepEqual(await calls(root), []);
  assert.equal(
    await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
    before,
  );
  await assert.rejects(access(join(root, "packages", "lib")));
});

for (const failure of ["generate", "install", "signal", "spawn"]) {
  test(`reports ${failure} failure with destination and no success message`, async (t) => {
    const root = await fixture(t);
    const env = await mockPnpm(root);
    if (failure === "signal") env.MOCK_SIGNAL = "1";
    else if (failure === "spawn") env.PATH = "";
    else env.MOCK_FAIL = failure;
    const result = await interact(
      root,
      projectAnswers("packages", undefined, "lib", "lib"),
      { env },
    );
    assert.equal(result.code, 1, result.output);
    assert.match(
      result.output,
      failure === "install" ? /pnpm installに失敗/ : /生成に失敗/,
    );
    assert.ok(result.output.includes(join(root, "packages", "lib")));
    assert.doesNotMatch(result.output, /追加が完了しました/);
    assert.equal(
      (await calls(root)).length,
      failure === "install" ? 2 : failure === "spawn" ? 0 : 1,
    );
  });
}

test("hands stdin to the generator after confirmation", async (t) => {
  const root = await fixture(t);
  const result = await interact(
    root,
    [
      ...projectAnswers("apps", "3", "api", "api"),
      ["CHILD_INPUT: ", "child answer"],
    ],
    { env: { ...(await mockPnpm(root)), MOCK_HANDOFF: "1" } },
  );
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /CHILD_INPUT_OK/);
});

test("navigates menus and confirmation with arrow keys", async (t) => {
  const root = await fixture(t);
  const answers = projectAnswers("apps", "3", "api", "api");
  answers[0][1] = keys.down + keys.up;
  answers[1][1] = keys.up.repeat(2); // Wrap from React Router to Hono.
  answers[4][1] = keys.right; // Change the initial Cancel selection to Run.
  const result = await interact(root, answers, { env: await mockPnpm(root) });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual((await calls(root))[0].args.slice(3, 5), [
    "--framework",
    "hono",
  ]);
});

for (const key of [keys.cancel, keys.escape]) {
  for (const index of [0, 1, 2, 3, 4]) {
    test(`cancels prompt ${index} with ${key === keys.cancel ? "Ctrl+C" : "Esc"} without mutations`, async (t) => {
      const root = await fixture(t);
      const before = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
      const answers = projectAnswers("apps", "1", "web", "web").slice(
        0,
        index + 1,
      );
      answers[index][1] = key;
      const result = await interact(root, answers, {
        env: await mockPnpm(root),
      });
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /実行をキャンセルしました/);
      assert.doesNotMatch(result.output, /失敗しました/);
      assert.deepEqual(await calls(root), []);
      assert.equal(
        await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
        before,
      );
    });
  }
}

for (const policy of [
  "allowBuilds:\n  esbuild: false # retain denial\n  workerd@1.2.3: true\n",
  "onlyBuiltDependencies: [lefthook]\nignoredBuiltDependencies: [esbuild]\n",
  "dangerouslyAllowAllBuilds: true\n",
]) {
  test(`preserves root build policy: ${policy.split("\n")[0]}`, async (t) => {
    const root = await fixture(
      t,
      `packages: ['apps/*', 'packages/*']\n${policy}`,
    );
    const result = await interact(
      root,
      projectAnswers("apps", "2", "worker", "worker"),
      { env: await mockPnpm(root) },
    );
    assert.equal(result.code, 0, result.output);
    const source = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
    const workspace = parse(source);
    assert.deepEqual(workspace.packages, ["apps/*", "packages/*"]);
    if (policy.startsWith("allowBuilds")) {
      assert.deepEqual(workspace.allowBuilds, {
        esbuild: false,
        "workerd@1.2.3": true,
      });
      assert.match(source, /# retain denial/);
    } else if (policy.startsWith("onlyBuilt")) {
      assert.deepEqual(workspace.onlyBuiltDependencies, [
        "lefthook",
        "workerd",
      ]);
      assert.deepEqual(workspace.ignoredBuiltDependencies, ["esbuild"]);
      assert.equal(workspace.allowBuilds, undefined);
    } else assert.equal(workspace.allowBuilds, undefined);
  });
}

for (const invalid of [
  "packages: [",
  "packages: invalid\n",
  "allowBuilds: []\n",
]) {
  test(`rejects malformed workspace before generation: ${invalid.trim()}`, async (t) => {
    const root = await fixture(t, invalid);
    const result = await interact(root, [], { env: await mockPnpm(root) });
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(await calls(root), []);
    assert.equal(
      await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
      invalid,
    );
  });
}

for (const choice of ["1", "2"]) {
  test(`keeps the new monorepo flow outside a workspace (${choice})`, async (t) => {
    const root = await fixture(t, null);
    const answers = [
      ["テンプレートを選択してください", choice === "1" ? "" : keys.down],
      ...(choice === "2"
        ? [["プロジェクト名を入力してください", "new-monorepo"]]
        : []),
      [prompts.confirm, "yes"],
    ];
    const result = await interact(root, answers, { env: await mockPnpm(root) });
    assert.equal(result.code, 0, result.output);
    assert.equal((await calls(root))[0].args[1], "create-turbo@latest");
    if (choice === "2") await access(join(root, "new-monorepo", "biome.json"));
  });
}

test("help, version and invalid options do not prompt or run commands", async (t) => {
  const root = await fixture(t);
  const env = await mockPnpm(root);
  for (const [args, code, pattern] of [
    [["--help"], 0, /Inside a workspace/],
    [["--version"], 0, /^\d+\.\d+\.\d+/],
    [["--help", "--version"], 0, /Usage:/],
    [["--unknown"], 1, /Unknown option/],
    [["extra"], 1, /Unexpected argument/],
  ]) {
    const result = await interact(root, [], { env, args });
    assert.equal(result.code, code, result.output);
    assert.match(result.output, pattern);
  }
  assert.deepEqual(await calls(root), []);
});

test("help and version work with stdin disconnected", async () => {
  for (const flag of ["--help", "--version"]) {
    const result = spawnSync(process.execPath, [cli, flag], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
});
