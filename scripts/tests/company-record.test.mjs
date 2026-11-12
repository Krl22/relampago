import assert from "node:assert/strict";
import { test } from "node:test";
import {
  companyRelatedQuery,
  COMPANY_FIELDS,
  validCompanyId,
  recordDate,
} from "../../src/lib/companyRecord.ts";
import { savedCompanyList } from "../../src/lib/companyListState.ts";
import { navigationActive } from "../../src/components/design/navigation.ts";

const company = "9f434163-b899-4564-9967-271e27490eeb";
const defaults = { search: "", status: "all", from: "", to: "", page: 0 };
function client() {
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
test("Every related list is read-only and scoped to the selected commerce", () => {
  for (const section of ["orders", "pickups", "settlements"]) {
    const mock = client();
    companyRelatedQuery(mock.client, company, section, {
      ...defaults,
      page: 2,
    });
    assert.deepEqual(mock.calls[0], ["from", section]);
    assert.ok(
      mock.calls.some(
        (c) => c[0] === "eq" && c[1] === "company_id" && c[2] === company,
      ),
    );
    assert.deepEqual(mock.calls.at(-1), ["range", 24, 35]);
    assert.equal(
      mock.calls.some((c) =>
        ["insert", "update", "delete", "rpc", "auth"].includes(c[0]),
      ),
      false,
    );
  }
  assert.equal(COMPANY_FIELDS.includes("intake_token"), false);
});
test("Invalid IDs, pages, date ranges and statuses are rejected before sending a request", () => {
  const invalid = [
    { id: "other)or(true", filters: defaults },
    { id: company, filters: { ...defaults, page: -1 } },
    { id: company, filters: { ...defaults, page: Number.MAX_SAFE_INTEGER } },
    {
      id: company,
      filters: { ...defaults, from: "2026-12-01", to: "2026-11-01" },
    },
    { id: company, filters: { ...defaults, status: "admin" } },
  ];
  for (const item of invalid) {
    const mock = client();
    assert.throws(() =>
      companyRelatedQuery(mock.client, item.id, "orders", item.filters),
    );
    assert.equal(
      mock.calls.some((c) => c[0] === "then"),
      false,
    );
  }
  assert.equal(validCompanyId(company), true);
  assert.equal(validCompanyId("../../another"), false);
});
test("Search input is sent as a bounded value and cannot remove the commerce scope", () => {
  const mock = client();
  companyRelatedQuery(mock.client, company, "orders", {
    ...defaults,
    search: "%Ana_",
  });
  assert.ok(
    mock.calls.some(
      (c) => c[0] === "ilike" && c[1] === "recipient_name" && c[2] === "%Ana%",
    ),
  );
  assert.equal(
    mock.calls.some((c) => c[0] === "or"),
    false,
  );
  assert.ok(mock.calls.some((c) => c[0] === "eq" && c[1] === "company_id"));
  const numeric = client();
  companyRelatedQuery(numeric.client, company, "orders", {
    ...defaults,
    search: "123",
  });
  assert.ok(
    numeric.calls.some(
      (c) => c[0] === "eq" && c[1] === "order_number" && c[2] === 123,
    ),
  );
});
test("Payment and scheduled-date filters use the correct columns", () => {
  const mock = client();
  companyRelatedQuery(mock.client, company, "settlements", {
    ...defaults,
    status: "unpaid",
    from: "2026-11-01",
    to: "2026-11-30",
  });
  assert.ok(
    mock.calls.some(
      (c) => c[0] === "is" && c[1] === "paid_at" && c[2] === null,
    ),
  );
  assert.ok(mock.calls.some((c) => c[0] === "gte" && c[1] === "period_to"));
  assert.ok(mock.calls.some((c) => c[0] === "lte" && c[1] === "period_from"));
});
test("List context survives a record round trip; malformed history state is ignored", () => {
  const filters = {
    name: "Comercio",
    ruc: "",
    phone: "",
    district: "",
    address: "",
    date: "",
    yape: "",
    portal: "has",
  };
  const state = {
    companyList: { filters, sortConfig: { key: "name", direction: "asc" } },
  };
  assert.deepEqual(savedCompanyList(state), state.companyList);
  assert.equal(
    savedCompanyList({ companyList: { filters: { name: 5 } } }),
    null,
  );
  assert.equal(savedCompanyList(null), null);
  assert.equal(navigationActive("/comercios", `/comercios/${company}`), true);
  assert.equal(navigationActive("/comercios", "/orders"), false);
});
test("Record dates handle missing values and preserve scheduled calendar dates in Lima", () => {
  assert.equal(recordDate(null), "—");
  assert.equal(recordDate("invalid"), "—");
  assert.match(recordDate("2026-11-06"), /6/);
});
