import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import ts from "typescript";
import type { ManifestTransform } from "workbox-build";

/** Precache the actual startup dependency graph; feature chunks are cached when visited. */
export const startupAssets: ManifestTransform = (entries) => {
  const root = resolve("dist");
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const queue = Array.from(
    html.matchAll(/(?:src|href)=["']([^"']+)["']/g),
    (match) => match[1].replace(/^\//, ""),
  ).filter((url) => url.endsWith(".js"));
  const login = entries.find((entry) =>
    /^assets\/Login-[^/]+\.js$/.test(entry.url),
  );
  if (login) queue.push(login.url);
  const core = new Set<string>();
  while (queue.length) {
    const url = queue.pop()!;
    if (core.has(url)) continue;
    core.add(url);
    const source = readFileSync(resolve(root, url), "utf8");
    const ast = ts.createSourceFile(
      url,
      source,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS,
    );
    for (const statement of ast.statements) {
      if (
        !(
          ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        )
      )
        continue;
      const specifier = statement.moduleSpecifier;
      if (
        !specifier ||
        !ts.isStringLiteral(specifier) ||
        !specifier.text.startsWith(".")
      )
        continue;
      const dependency = posix.normalize(
        posix.join(posix.dirname(url), specifier.text),
      );
      if (dependency.startsWith("assets/") && dependency.endsWith(".js"))
        queue.push(dependency);
    }
  }
  return {
    manifest: entries.filter(
      (entry) => !entry.url.endsWith(".js") || core.has(entry.url),
    ),
    warnings: [],
  };
};
