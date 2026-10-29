import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseAllDocuments } from "yaml";
import { fixture, interact, projectAnswers, write } from "./helpers.mjs";

async function pnpm(cwd, args) {
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pnpm ${args.join(" ")} failed: ${code}`)),
    );
  });
}

test("real generators install and build all five projects in one workspace", {
  timeout: 600_000,
}, async (t) => {
  const root = await fixture(t);
  await write(
    join(root, "package.json"),
    JSON.stringify({
      name: "smoke-root",
      private: true,
      packageManager: "pnpm@12.16.1",
    }),
  );
  for (const [destination, template, name] of [
    ["packages", undefined, "library"],
    ["apps", "2", "worker"],
    ["apps", "3", "api"],
    ["apps", "1", "web"],
    ["apps", "4", "void-app"],
  ]) {
    await t.test(name, { timeout: 180_000 }, async () => {
      const result = await interact(
        root,
        projectAnswers(destination, template, name, `@smoke/${name}`),
        { timeout: 150_000, env: { WRANGLER_SEND_METRICS: "false" } },
      );
      assert.equal(result.code, 0, result.output);
      const target = join(root, destination, name);
      const manifest = JSON.parse(
        await readFile(join(target, "package.json"), "utf8"),
      );
      assert.equal(manifest.name, `@smoke/${name}`);
      const lockfiles = parseAllDocuments(
        await readFile(join(root, "pnpm-lock.yaml"), "utf8"),
      ).map((document) => document.toJSON());
      assert.ok(
        lockfiles.some(
          (lockfile) => lockfile.importers?.[`${destination}/${name}`],
        ),
      );
      if (name === "void-app") {
        await pnpm(root, ["--filter", "@smoke/void-app", "run", "dev:setup"]);
        await pnpm(root, ["--filter", "@smoke/void-app", "run", "build"]);
      } else if (destination === "packages" || name === "web") {
        await pnpm(root, ["--filter", `@smoke/${name}`, "run", "build"]);
        if (destination === "packages") {
          assert.ok(
            Object.values(manifest.scripts).some((script) =>
              script.includes("--watch"),
            ),
          );
          assert.ok(
            (await readdir(join(target, "dist"))).some((file) =>
              /^index\.d\.(?:ts|mts|cts)$/.test(file),
            ),
          );
        }
      } else {
        await access(join(target, "wrangler.jsonc"));
        await pnpm(target, [
          "exec",
          "wrangler",
          "deploy",
          "--dry-run",
          "--outdir",
          "dist",
        ]);
      }
    });
  }
  await pnpm(root, ["install", "--frozen-lockfile"]);
});
