const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../src/db");
const { createApp } = require("../src/app");

let server;
let base;
const kitchenAuth = { Authorization: "Basic " + Buffer.from("kitchen:secret").toString("base64") };

before(async () => {
    const app = createApp({ db: openDatabase(":memory:"), kitchenPassword: "secret" });
    await new Promise((resolve) => (server = app.listen(0, resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body, headers = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const patch = (path, body, headers = {}) =>
    fetch(base + path, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("the menu lists the seeded items with prices in cents", async () => {
    const menu = await (await fetch(base + "/api/menu")).json();
    assert.equal(menu.length, 6);
    assert.deepEqual(menu[0], {
        id: 1,
        name: "The Byte",
        tag: "Signature",
        description: "Beef patty, cheddar, tomato, butter lettuce and house sauce on a sesame bun.",
        priceCents: 950,
    });
});

test("an order uses database prices and ignores prices sent by the client", async () => {
    const res = await post("/api/orders", {
        name: "Ali",
        fulfilment: "pickup",
        items: [{ id: 1, quantity: 2, priceCents: 1 }, { id: 5, quantity: 1 }, { id: 1, quantity: 1 }],
    });
    assert.equal(res.status, 201);
    const order = await res.json();
    assert.equal(order.status, "received");
    assert.equal(order.totalCents, 3 * 950 + 350);
    assert.deepEqual(order.items.map((i) => [i.id, i.quantity]), [[1, 3], [5, 1]]);
    assert.match(order.code, /^[A-Za-z0-9_-]{8}$/);

    const fetched = await (await fetch(`${base}/api/orders/${order.code}`)).json();
    assert.deepEqual(fetched, order);
});

test("invalid orders are rejected with a reason", async () => {
    const cases = [
        [{ fulfilment: "pickup", items: [{ id: 1, quantity: 1 }] }, /name/],
        [{ name: "A", fulfilment: "drone", items: [{ id: 1, quantity: 1 }] }, /pickup, table or delivery/],
        [{ name: "A", fulfilment: "delivery", address: "Hamra, building 4", items: [{ id: 1, quantity: 1 }] }, /phone/],
        [{ name: "A", fulfilment: "delivery", phone: "70 123 456", address: "Hm", items: [{ id: 1, quantity: 1 }] }, /address/],
        [{ name: "A", fulfilment: "table", items: [{ id: 1, quantity: 1 }] }, /table number/],
        [{ name: "A", fulfilment: "pickup", items: [] }, /between 1 and 20 items/],
        [{ name: "A", fulfilment: "pickup", items: [{ id: 1, quantity: 0 }] }, /quantity/],
        [{ name: "A", fulfilment: "pickup", items: [{ id: 999, quantity: 1 }] }, /not available/],
        [{ name: "A", fulfilment: "pickup", items: [{ id: 1, quantity: 15 }, { id: 1, quantity: 15 }] }, /At most 20/],
    ];
    for (const [body, reason] of cases) {
        const res = await post("/api/orders", body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match((await res.json()).error, reason);
    }

    const broken = await fetch(base + "/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(broken.status, 400);
});

test("delivery is free and paid in cash on delivery; other orders pay at the counter", async () => {
    const delivery = await (await post("/api/orders", {
        name: "Ali",
        fulfilment: "delivery",
        phone: "+961 70 123-456",
        address: "Hamra Street, building 4, floor 2",
        items: [{ id: 1, quantity: 1 }],
    })).json();
    assert.equal(delivery.payment, "cash_on_delivery");
    assert.equal(delivery.deliveryFeeCents, 0);
    assert.equal(delivery.totalCents, 950);
    assert.equal(delivery.phone, "+96170123456");

    const pickup = await (await post("/api/orders", { name: "Ali", fulfilment: "pickup", items: [{ id: 1, quantity: 1 }] })).json();
    assert.equal(pickup.payment, "cash_at_counter");
    assert.equal(pickup.phone, null);
});

test("a delivery order goes out for delivery instead of being collected", async () => {
    const order = await (await post("/api/orders", {
        name: "Abbas", fulfilment: "delivery", phone: "71000000", address: "Verdun, building 9", items: [{ id: 3, quantity: 1 }],
    })).json();
    const url = `/api/kitchen/orders/${order.code}`;
    await patch(url, { status: "cooking" }, kitchenAuth);
    await patch(url, { status: "ready" }, kitchenAuth);
    assert.equal((await patch(url, { status: "collected" }, kitchenAuth)).status, 409);
    assert.equal((await (await patch(url, { status: "out_for_delivery" }, kitchenAuth)).json()).status, "out_for_delivery");
    const active = await (await fetch(base + "/api/kitchen/orders", { headers: kitchenAuth })).json();
    assert.ok(active.some((o) => o.code === order.code));
    assert.equal((await (await patch(url, { status: "delivered" }, kitchenAuth)).json()).status, "delivered");
});

test("unknown orders return 404", async () => {
    assert.equal((await fetch(base + "/api/orders/nope")).status, 404);
    assert.equal((await fetch(base + "/orders/nope")).status, 404);
});

test("the kitchen needs the password", async () => {
    assert.equal((await fetch(base + "/api/kitchen/orders")).status, 401);
    assert.equal((await fetch(base + "/kitchen")).status, 401);
    const wrong = { Authorization: "Basic " + Buffer.from("kitchen:nope").toString("base64") };
    assert.equal((await fetch(base + "/api/kitchen/orders", { headers: wrong })).status, 401);
    assert.equal((await fetch(base + "/api/kitchen/orders", { headers: kitchenAuth })).status, 200);
});

test("the kitchen moves an order forward, and only forward", async () => {
    const order = await (await post("/api/orders", { name: "Abbas", fulfilment: "table", tableNumber: 4, items: [{ id: 2, quantity: 1 }] })).json();
    const url = `/api/kitchen/orders/${order.code}`;

    assert.equal((await patch(url, { status: "cooking" })).status, 401);
    assert.equal((await patch(url, { status: "ready" }, kitchenAuth)).status, 409);
    assert.equal((await patch(url, { status: "burnt" }, kitchenAuth)).status, 400);
    assert.equal((await (await patch(url, { status: "cooking" }, kitchenAuth)).json()).status, "cooking");
    assert.equal((await (await patch(url, { status: "ready" }, kitchenAuth)).json()).status, "ready");

    const active = await (await fetch(base + "/api/kitchen/orders", { headers: kitchenAuth })).json();
    assert.ok(active.some((o) => o.code === order.code && o.tableNumber === 4));

    assert.equal((await (await patch(url, { status: "collected" }, kitchenAuth)).json()).status, "collected");
    const after = await (await fetch(base + "/api/kitchen/orders", { headers: kitchenAuth })).json();
    assert.ok(!after.some((o) => o.code === order.code));
});

test("a customer's order page receives live status updates", async () => {
    const order = await (await post("/api/orders", { name: "Live", fulfilment: "pickup", items: [{ id: 6, quantity: 1 }] })).json();
    const controller = new AbortController();
    const res = await fetch(`${base}/api/orders/${order.code}/events`, { signal: controller.signal });
    const reader = res.body.getReader();

    await patch(`/api/kitchen/orders/${order.code}`, { status: "cooking" }, kitchenAuth);
    let text = "";
    while (!text.includes("\n\n")) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();

    const event = JSON.parse(text.slice(text.indexOf("data: ") + 6).trim());
    assert.equal(event.code, order.code);
    assert.equal(event.status, "cooking");
});

test("the pages render", async () => {
    const home = await (await fetch(base + "/")).text();
    assert.match(home, /data-id="1"/);
    assert.match(home, /\$9\.50/);
    const order = await (await post("/api/orders", { name: "Page", fulfilment: "pickup", items: [{ id: 1, quantity: 1 }] })).json();
    const page = await (await fetch(`${base}/orders/${order.code}`)).text();
    assert.match(page, new RegExp(`#${order.number}`));
    assert.equal((await fetch(base + "/kitchen", { headers: kitchenAuth })).status, 200);
});

test("a database from before delivery support is upgraded in place", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { DatabaseSync } = require("node:sqlite");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "btb-")), "old.db");

    // The first schema, as the earlier version created it (user_version 0).
    const old = new DatabaseSync(file);
    old.exec(`
        CREATE TABLE orders (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL,
            fulfilment TEXT NOT NULL CHECK (fulfilment IN ('pickup', 'table')), table_number INTEGER,
            note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'received', total_cents INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT 'x', updated_at TEXT NOT NULL DEFAULT 'x');
        INSERT INTO orders (code, customer_name, fulfilment, total_cents) VALUES ('old', 'Ali', 'pickup', 950);
    `);
    old.close();

    const db = openDatabase(file);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    const row = db.prepare("SELECT customer_name, payment FROM orders WHERE code = 'old'").get();
    assert.equal(row.customer_name, "Ali");
    assert.equal(row.payment, "cash_at_counter");
    db.close();
});
