import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  matchesGlob,
  posix,
  relative,
  resolve,
} from "node:path";
import { glob } from "tinyglobby";
import validatePackageName from "validate-npm-package-name";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

export type Destination = "apps" | "packages";
export type AppTemplate = "react-router" | "hello-world" | "hono";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function findWorkspaceRoot(
  startDirectory: string,
): Promise<string | undefined> {
  let directory = resolve(startDirectory);
  let turboRoot: string | undefined;
  while (true) {
    if (await exists(resolve(directory, "pnpm-workspace.yaml")))
      return directory;
    if (!turboRoot && (await exists(resolve(directory, "turbo.json")))) {
      turboRoot = directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return turboRoot;
    directory = parent;
  }
}

export async function readWorkspace(root: string) {
  const path = resolve(root, "pnpm-workspace.yaml");
  let source = "";
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(
      `${path}: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  if (document.contents && !isMap(document.contents)) {
    throw new Error(`${path}: YAMLのトップレベルにはマップが必要です。`);
  }
  const packages = document.get("packages");
  if (
    packages !== undefined &&
    (!isSeq(packages) ||
      !packages.toJSON().every((value: unknown) => typeof value === "string"))
  ) {
    throw new Error(`${path}: packagesには文字列の配列が必要です。`);
  }
  for (const key of ["allowBuilds", "permissions"]) {
    const value = document.get(key);
    if (value !== undefined && !isMap(value)) {
      throw new Error(`${path}: ${key}にはマップが必要です。`);
    }
  }
  return document;
}

function workspacePatterns(
  document: Awaited<ReturnType<typeof readWorkspace>>,
): string[] {
  const packages = document.get("packages");
  return isSeq(packages) ? (packages.toJSON() as string[]) : [];
}

export function packageNameError(name: string): string | undefined {
  if (!validatePackageName(name).validForNewPackages) {
    return "有効なパッケージ名を入力してください（小文字、@scope/nameも使用できます）。";
  }
}

export async function directoryError(
  root: string,
  destination: Destination,
  name: string,
): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    return "ディレクトリー名には英数字、ドット、ハイフン、アンダースコアを使用してください（パスは指定できません）。";
  }
  if (name === "node_modules") {
    return "node_modulesはworkspaceに登録できないため、別のディレクトリー名を入力してください。";
  }
  if (
    destination === "apps" &&
    (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) || name.length > 58)
  ) {
    return "appsのディレクトリー名には58文字以内の小文字英数字とハイフンを使用し、先頭と末尾は英数字にしてください。";
  }
  const target = resolve(root, destination, name);
  if (await exists(target)) return `作成先は既に存在します: ${target}`;
  if (await exists(resolve(root, destination))) {
    const parent = relative(
      await realpath(root),
      await realpath(resolve(root, destination)),
    );
    if (parent === ".." || parent.startsWith("../") || isAbsolute(parent)) {
      return `作成先はworkspaceの外を参照しています: ${target}`;
    }
  }
  const document = await readWorkspace(root);
  if (
    workspacePatterns(document).some(
      (pattern) =>
        pattern.startsWith("!") &&
        matchesGlob(
          `${destination}/${name}`,
          posix.normalize(pattern.slice(1)),
        ),
    )
  ) {
    return `作成先はworkspaceの除外設定に一致します: ${destination}/${name}`;
  }
}

export async function workspacePackageNames(
  root: string,
): Promise<Set<string>> {
  const document = await readWorkspace(root);
  // Include both directories because integration adds both workspace patterns.
  const directories = await glob(
    [...workspacePatterns(document), "apps/*", "packages/*"],
    {
      cwd: root,
      onlyDirectories: true,
      absolute: true,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    },
  );
  const names = new Set<string>();
  for (const directory of new Set([root, ...directories])) {
    const manifest = resolve(directory, "package.json");
    try {
      const packageJson = JSON.parse(await readFile(manifest, "utf8"));
      if (typeof packageJson.name === "string") names.add(packageJson.name);
    } catch (error) {
      if (!isMissing(error)) throw new Error(`${manifest}: ${String(error)}`);
    }
  }
  return names;
}

export function generatorArguments(
  destination: Destination,
  name: string,
  template?: AppTemplate,
): string[] {
  const target = `${destination}/${name}`;
  if (destination === "packages") {
    return ["dlx", "create-tsdown@latest", target, "--template", "minimal"];
  }
  return [
    "dlx",
    "create-cloudflare@latest",
    target,
    ...(template === "hello-world"
      ? ["--type", template]
      : ["--framework", template ?? "react-router"]),
    "--platform",
    "workers",
    "--lang",
    "ts",
    "--no-deploy",
    "--no-git",
    "--accept-defaults",
  ];
}

export async function integrateWorkspace(
  root: string,
  target: string,
  packageName: string,
  cloudflare: boolean,
): Promise<void> {
  const manifest = resolve(target, "package.json");
  const packageJson = JSON.parse(await readFile(manifest, "utf8"));
  packageJson.name = packageName;
  await writeFile(manifest, `${JSON.stringify(packageJson, null, 2)}\n`);

  const document = await readWorkspace(root);
  const patterns = workspacePatterns(document);
  if (!document.has("packages")) document.set("packages", []);
  for (const pattern of ["apps/*", "packages/*"]) {
    if (!patterns.includes(pattern)) document.addIn(["packages"], pattern);
  }
  if (cloudflare && document.get("dangerouslyAllowAllBuilds") !== true) {
    for (const name of ["esbuild", "workerd"]) {
      // Keep explicit denials and version-specific decisions in the root policy.
      const builds = document.get("allowBuilds");
      const permissions = document.get("permissions");
      const hasDecision = [builds, permissions].some(
        (map) =>
          isMap(map) &&
          map.items.some(({ key, value }) => {
            const matcher = String(key);
            const decision =
              map === permissions
                ? isMap(value)
                  ? value.get("build")
                  : undefined
                : isScalar(value)
                  ? value.value
                  : value;
            if (typeof decision !== "boolean") return false;
            return (
              matcher === name ||
              matcher.startsWith(`${name}@`) ||
              matchesGlob(name, matcher)
            );
          }),
      );
      const legacyDenied = [
        "ignoredBuiltDependencies",
        "neverBuiltDependencies",
      ].some((key) => {
        const value = document.get(key);
        return isSeq(value) && value.toJSON().includes(name);
      });
      if (
        hasDecision ||
        legacyDenied ||
        document.has("onlyBuiltDependenciesFile")
      )
        continue;
      if (isSeq(document.get("onlyBuiltDependencies"))) {
        const allowed = document.get("onlyBuiltDependencies");
        if (isSeq(allowed) && !allowed.toJSON().includes(name))
          document.addIn(["onlyBuiltDependencies"], name);
      } else {
        document.setIn(["allowBuilds", name], true);
      }
    }
  }
  await writeFile(resolve(root, "pnpm-workspace.yaml"), document.toString());

  if (cloudflare) {
    for (const path of [
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      "node_modules",
    ]) {
      await rm(resolve(target, path), { recursive: true, force: true });
    }
  }
}
