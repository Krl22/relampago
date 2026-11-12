import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import ts from "typescript";
import { navigationFor } from "../../src/components/design/navigation.ts";

const storage = new Map([["relampago.design.v1", "lightning"]]);
let writes = 0;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    writes++;
    storage.set(key, String(value));
  },
};
globalThis.window = new EventTarget();
const pref = await import("../../src/components/design/preference.ts");

test("Classic is the default after migration; explicit view choices persist", () => {
  assert.equal(pref.readDesignMode(), "classic");
  let updates = 0;
  const unsubscribe = pref.subscribeDesign(() => updates++);
  pref.writeDesignMode("classic");
  assert.equal(pref.readDesignMode(), "classic");
  assert.equal(storage.get("relampago.design.v2"), "classic");
  assert.equal(updates, 1);
  unsubscribe();
  pref.writeDesignMode("lightning");
  assert.equal(updates, 1);
  assert.equal(pref.readDesignMode(), "lightning");
});
test("Explicit comparison URLs and invalid values are handled safely", () => {
  assert.equal(pref.requestedDesign("clasica"), "classic");
  assert.equal(pref.requestedDesign("lightning"), "lightning");
  assert.equal(pref.requestedDesign("admin"), null);
  storage.set("relampago.design.v2", "unknown");
  assert.equal(pref.readDesignMode(), "lightning");
});
test("Changing appearance preserves query filters and activation parameters without mutating the input", () => {
  const original = new URLSearchParams(
    "panel=notas&c=example-activation-token&status=pending&status=picked_up",
  );
  const next = pref.designParams(original, "classic");
  assert.equal(next.get("c"), "example-activation-token");
  assert.equal(next.get("panel"), "notas");
  assert.deepEqual(next.getAll("status"), ["pending", "picked_up"]);
  assert.equal(next.get("vista"), "clasica");
  assert.equal(original.has("vista"), false);
  assert.equal(pref.designParams(next, "lightning").get("vista"), "lightning");
});
test("An external preference update notifies subscribers without writing back in a loop", () => {
  let updates = 0;
  const unsubscribe = pref.subscribeDesign(() => updates++);
  const before = writes;
  storage.set("relampago.design.v2", "classic");
  window.dispatchEvent(new Event("storage"));
  assert.equal(pref.readDesignMode(), "classic");
  assert.equal(updates, 1);
  assert.equal(writes, before);
  unsubscribe();
});
test("Navigation remains limited to each role; assistant stays admin-only", () => {
  const paths = (role) => navigationFor(role).map((item) => item.href);
  assert.ok(paths("admin").includes("/asistente"));
  assert.ok(paths("admin").includes("/stock"));
  for (const role of ["staff", "client", "courier"])
    assert.equal(paths(role).includes("/asistente"), false);
  for (const role of ["admin", "staff", "client"])
    assert.equal(paths(role).includes("/my-deliveries"), false);
  for (const path of paths("client"))
    assert.ok(
      [
        "/mis-pedidos",
        "/nuevo-pedido",
        "/carga-masiva",
        "/my-stock",
        "/mis-liquidaciones",
        "/mi-comercio",
        "/tarifario",
      ].includes(path),
    );
  assert.equal(paths("staff").includes("/stock"), false);
  assert.deepEqual(paths(undefined), []);
});
test("The Lightning stylesheet is entirely scoped, so classic styles are recoverable", () => {
  const sheet = postcss.parse(readFileSync("src/lightning.css", "utf8"));
  sheet.walkRules((rule) => {
    for (const selector of postcss.list.comma(rule.selector))
      assert.match(
        selector,
        /^(\[data-design="lightning"\]|:root\[data-design="lightning"\])/,
      );
  });
});

function routeManifest(path) {
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const manifest = [];
  const opening = (n) =>
    ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : null;
  const attribute = (open, name) =>
    open.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === name,
    );
  const visit = (node) => {
    const open = opening(node);
    if (open?.tagName.getText(ast) === "Route") {
      const pathProp = attribute(open, "path");
      if (pathProp && ts.isStringLiteral(pathProp.initializer)) {
        const guards = [];
        let parent = node;
        while (parent) {
          const p = opening(parent);
          if (p?.tagName.getText(ast) === "Route") {
            const element = attribute(p, "element")?.initializer?.expression;
            const guard = element && opening(element);
            if (guard?.tagName.getText(ast) === "ProtectedRoute") {
              const roles = attribute(guard, "allowedRoles")?.initializer
                ?.expression;
              guards.push(
                roles && ts.isArrayLiteralExpression(roles)
                  ? roles.elements.map((e) => e.text)
                  : ["authenticated"],
              );
            }
          }
          parent = parent.parent;
        }
        manifest.push({ path: pathProp.initializer.text, guards });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return manifest;
}
test("All route paths and their authentication/role guards match the pre-redesign application", () => {
  const routes = routeManifest("src/App.tsx");
  const record = routes.filter(
    (route) => route.path === "/comercios/:companyId",
  );
  assert.equal(record.length, 1);
  assert.deepEqual(record[0].guards, [["admin"], ["authenticated"]]);
  const courierRecord = routes.filter(route => route.path === "/couriers/:courierId");
  assert.equal(courierRecord.length, 1);
  assert.deepEqual(courierRecord[0].guards, [["admin"], ["authenticated"]]);
  assert.deepEqual(
    routes.filter((route) => !["/comercios/:companyId", "/couriers/:courierId"].includes(route.path)),
    routeManifest("work/checkpoints/lightning-app-2026-11-06/src/App.tsx"),
  );
});
test("The redesign leaves every existing page database/API query unchanged", () => {
  const pages = [
    "Dashboard",
    "Orders",
    "Companies",
    "Couriers",
    "Stock",
    "Settlements",
    "Pickups",
    "CourierMap",
    "MyDeliveries",
    "MyPickups",
    "MyRoute",
    "Login",
    "ActivateAccount",
    "PublicOrderPage",
    "Coverage",
    "EnterpriseChat",
    "client/MyOrders",
    "client/NewOrder",
    "client/BulkOrders",
    "client/MySettlements",
    "client/MyCompany",
  ];
  const semantic = (node) => {
    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(semantic(child));
    });
    return [
      ts.SyntaxKind[node.kind],
      ts.isIdentifier(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isNumericLiteral(node)
        ? node.text
        : null,
      ...children,
    ];
  };
  const queries = (path) => {
    const source = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const result = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && /^supabase\s*\./.test(node.getText(ast)))
        result.push(semantic(node));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return result;
  };
  // Every pre-redesign query must still exist unchanged; later features may add new ones
  // (e.g. the bulk upload reads the merchant's stock to link products).
  for (const page of pages) {
    const current = queries(`src/pages/${page}.tsx`).map((q) => JSON.stringify(q));
    for (const original of queries(
      `work/checkpoints/lightning-app-2026-11-06/src/pages/${page}.tsx`,
    )) {
      const at = current.indexOf(JSON.stringify(original));
      assert.ok(at >= 0, `${page}: a pre-redesign query changed or was removed`);
      current.splice(at, 1);
    }
  }
});
test("Blocked browser storage falls back to the current session preference", () => {
  globalThis.localStorage.setItem = () => {
    throw new Error("storage blocked");
  };
  pref.writeDesignMode("classic");
  assert.equal(pref.readDesignMode(), "classic");
  pref.writeDesignMode("lightning");
  assert.equal(pref.readDesignMode(), "lightning");
});
