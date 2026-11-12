import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COURIER_FIELDS,
  courierOrdersQuery,
  courierPickupsQuery,
  courierActivityQuery,
  validCourierId,
} from "../../src/lib/courierRecord.ts";
import { recordOrigin, savedList } from "../../src/lib/recordNavigation.ts";
import { navigationActive } from "../../src/components/design/navigation.ts";
const id = "00000000-0000-4000-8000-000000000001";
const filters = { search: "", status: "all", from: "", to: "", page: 0 };
function mock() {
  const calls = [];
  const query = new Proxy(
    {},
    {
      get:
        (_, method) =>
        (...args) => {
          calls.push([method, ...args]);
          return query;
        },
    },
  );
  return {
    calls,
    client: {
      from: (table) => {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}
test("Courier order queries use assigned_courier and read-only operations", () => {
  const m = mock();
  courierOrdersQuery(m.client, id, {
    ...filters,
    page: 2,
    status: "in_transit",
  });
  assert.deepEqual(m.calls[0], ["from", "orders"]);
  assert.ok(
    m.calls.some(
      (c) => c[0] === "eq" && c[1] === "assigned_courier" && c[2] === id,
    ),
  );
  assert.equal(
    m.calls.some((c) => c[0] === "eq" && c[1] === "company_id"),
    false,
  );
  assert.deepEqual(m.calls.at(-1), ["range", 24, 35]);
  assert.equal(
    m.calls.some((c) =>
      ["insert", "update", "delete", "rpc", "auth"].includes(c[0]),
    ),
    false,
  );
  assert.equal(COURIER_FIELDS, "id,full_name,email,created_at,role");
});
test("Pickup lists are scoped to the courier assignment, including nested status and dates", () => {
  const m = mock();
  courierPickupsQuery(m.client, id, {
    ...filters,
    status: "picked_up",
    from: "2026-11-01",
    to: "2026-11-30",
    search: "123",
  });
  assert.deepEqual(m.calls[0], ["from", "pickup_assignments"]);
  assert.ok(
    m.calls.some((c) => c[0] === "eq" && c[1] === "courier_id" && c[2] === id),
  );
  assert.ok(
    m.calls.some(
      (c) => c[0] === "eq" && c[1] === "pickup.status" && c[2] === "picked_up",
    ),
  );
  assert.ok(
    m.calls.some((c) => c[0] === "gte" && c[1] === "pickup.scheduled_date"),
  );
  assert.ok(
    m.calls.some(
      (c) => c[0] === "eq" && c[1] === "pickup.pickup_number" && c[2] === 123,
    ),
  );
});
test("Activity conditions accept only UUIDs and cannot interpolate an arbitrary filter", () => {
  const m = mock();
  courierActivityQuery(m.client, id);
  assert.deepEqual(
    m.calls.find((c) => c[0] === "or"),
    ["or", `actor_id.eq.${id},courier_id.eq.${id}`],
  );
  assert.deepEqual(m.calls.at(-1), ["limit", 50]);
  const invalid = mock();
  assert.throws(() =>
    courierActivityQuery(invalid.client, `${id},actor_id.neq.null`),
  );
  assert.equal(invalid.calls.length, 0);
});
test("Invalid IDs, status, dates and pages are rejected", () => {
  assert.equal(validCourierId(id), true);
  assert.equal(validCourierId("../admin"), false);
  for (const build of [courierOrdersQuery, courierPickupsQuery]) {
    assert.throws(() => build(mock().client, "invalid", filters));
    assert.throws(() => build(mock().client, id, { ...filters, page: -1 }));
    assert.throws(() =>
      build(mock().client, id, { ...filters, status: "admin" }),
    );
    assert.throws(() =>
      build(mock().client, id, {
        ...filters,
        from: "2026-12-01",
        to: "2026-11-01",
      }),
    );
  }
});
test("Internal record back links preserve business filters without overriding the chosen design", () => {
  assert.deepEqual(
    recordOrigin({
      recordOrigin: { path: "/stock?company=example&vista=lightning" },
    }),
    { path: "/stock?company=example", label: "Inventario global" },
  );
  assert.equal(
    recordOrigin({ recordOrigin: { path: "https://evil.invalid/stock" } }),
    null,
  );
  assert.equal(
    recordOrigin({ recordOrigin: { path: "//evil.invalid/stock" } }),
    null,
  );
  assert.equal(recordOrigin({ recordOrigin: { path: "/login" } }), null);
  assert.equal(
    recordOrigin({ recordOrigin: { path: `/couriers/${id}?tab=orders` } })
      ?.label,
    "Ficha del motorizado",
  );
});
test("Courier and inventory list state is validated and restored separately", () => {
  const state = {
    courierList: {
      filters: { name: "Carlos", date: "" },
      sortConfig: { key: "name", direction: "asc" },
    },
  };
  assert.deepEqual(
    savedList(state, "courierList", { name: "", date: "" }),
    state.courierList,
  );
  assert.equal(savedList(state, "stockList", { company: "" }), null);
  assert.equal(
    savedList(
      { courierList: { filters: { name: 5 }, sortConfig: {} } },
      "courierList",
      { name: "", date: "" },
    ),
    null,
  );
  assert.equal(navigationActive("/couriers", `/couriers/${id}`), true);
  assert.equal(navigationActive("/couriers", "/comercios"), false);
});
