const crypto = require("node:crypto");

const STATUSES = ["received", "cooking", "ready", "out_for_delivery", "delivered", "collected", "cancelled"];
// Which status each status may move to. The kitchen can only move orders
// forward, and a ready order leaves in a different way for delivery.
const NEXT = {
    received: ["cooking", "cancelled"],
    cooking: ["ready", "cancelled"],
    ready: { delivery: ["out_for_delivery"], pickup: ["collected"], table: ["collected"] },
    out_for_delivery: ["delivered"],
    delivered: [],
    collected: [],
    cancelled: [],
};
const nextStatuses = (order) => {
    const next = NEXT[order.status];
    return Array.isArray(next) ? next : next[order.fulfilment];
};
// Headlines for the customer's order page. The page script reads the same text from /api/orders.
const TITLES = {
    received: "Order <em>received.</em>",
    cooking: "On the <em>grill.</em>",
    ready: "Ready to <em>go.</em>",
    out_for_delivery: "On the <em>way.</em>",
    delivered: "Enjoy <em>it.</em>",
    collected: "Enjoy <em>it.</em>",
    cancelled: "Order <em>cancelled.</em>",
};
const ACTIVE = ["received", "cooking", "ready", "out_for_delivery"];
const FULFILMENTS = ["pickup", "table", "delivery"];
// Delivery is free. Kept as a value so a fee can be introduced in one place.
const DELIVERY_FEE_CENTS = 0;

const MAX_LINES = 20;
const MAX_QUANTITY = 20;

class OrderError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function listMenu(db) {
    return db
        .prepare("SELECT id, name, tag, description, price_cents AS priceCents FROM menu_items WHERE available = 1 ORDER BY position")
        .all();
}

// Validates a customer's order and stores it. Prices always come from the
// database, never from the request.
function createOrder(db, input) {
    const body = input && typeof input === "object" ? input : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 40) throw new OrderError(400, "Enter a name between 1 and 40 characters.");

    const fulfilment = FULFILMENTS.includes(body.fulfilment) ? body.fulfilment : null;
    if (!fulfilment) throw new OrderError(400, "Choose pickup, table or delivery.");
    let tableNumber = null;
    if (fulfilment === "table") {
        tableNumber = Number(body.tableNumber);
        if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 99) {
            throw new OrderError(400, "Enter a table number between 1 and 99.");
        }
    }
    let phone = null;
    let address = null;
    if (fulfilment === "delivery") {
        phone = typeof body.phone === "string" ? body.phone.replace(/[\s()-]/g, "") : "";
        if (!/^\+?\d{7,15}$/.test(phone)) throw new OrderError(400, "Enter a phone number for the driver.");
        address = typeof body.address === "string" ? body.address.trim() : "";
        if (address.length < 5 || address.length > 200) throw new OrderError(400, "Enter a delivery address between 5 and 200 characters.");
    }
    // Cash only: paid to the driver for deliveries, at the counter otherwise.
    const payment = fulfilment === "delivery" ? "cash_on_delivery" : "cash_at_counter";
    const deliveryFeeCents = fulfilment === "delivery" ? DELIVERY_FEE_CENTS : 0;

    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 200) throw new OrderError(400, "Keep the note under 200 characters.");

    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_LINES) {
        throw new OrderError(400, "Add between 1 and 20 items.");
    }

    const findItem = db.prepare("SELECT id, name, price_cents FROM menu_items WHERE id = ? AND available = 1");
    const quantities = new Map();
    for (const line of body.items) {
        const id = Number(line && line.id);
        const quantity = Number(line && line.quantity);
        if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            throw new OrderError(400, "Each item needs a menu id and a quantity between 1 and 20.");
        }
        quantities.set(id, (quantities.get(id) || 0) + quantity);
    }

    const lines = [...quantities].map(([id, quantity]) => {
        const item = findItem.get(id);
        if (!item) throw new OrderError(400, `Menu item ${id} is not available.`);
        if (quantity > MAX_QUANTITY) throw new OrderError(400, `At most ${MAX_QUANTITY} of ${item.name}.`);
        return { id: item.id, name: item.name, quantity, unitPriceCents: item.price_cents };
    });
    const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0) + deliveryFeeCents;

    // The code is the order's public id: random, so customers cannot guess each other's orders.
    const code = crypto.randomBytes(6).toString("base64url");
    db.exec("BEGIN");
    try {
        const { lastInsertRowid } = db
            .prepare(
                `INSERT INTO orders (code, customer_name, fulfilment, table_number, phone, address, payment, delivery_fee_cents, note, total_cents)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(code, name, fulfilment, tableNumber, phone, address, payment, deliveryFeeCents, note, totalCents);
        const insertLine = db.prepare(
            "INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)"
        );
        lines.forEach((l) => insertLine.run(lastInsertRowid, l.id, l.name, l.quantity, l.unitPriceCents));
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
    return getOrder(db, code);
}

function toOrder(db, row) {
    const items = db
        .prepare("SELECT menu_item_id AS id, name, quantity, unit_price_cents AS unitPriceCents FROM order_items WHERE order_id = ?")
        .all(row.id);
    return {
        code: row.code,
        number: String(row.id).padStart(3, "0"),
        name: row.customer_name,
        fulfilment: row.fulfilment,
        tableNumber: row.table_number,
        phone: row.phone,
        address: row.address,
        payment: row.payment,
        deliveryFeeCents: row.delivery_fee_cents,
        note: row.note,
        status: row.status,
        totalCents: row.total_cents,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        items,
    };
}

function getOrder(db, code) {
    const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(String(code));
    return row ? toOrder(db, row) : null;
}

function listActiveOrders(db) {
    return db
        .prepare(`SELECT * FROM orders WHERE status IN (${ACTIVE.map(() => "?").join(",")}) ORDER BY id`)
        .all(...ACTIVE)
        .map((row) => toOrder(db, row));
}

function updateStatus(db, code, status) {
    const order = getOrder(db, code);
    if (!order) throw new OrderError(404, "Order not found.");
    if (!STATUSES.includes(status)) throw new OrderError(400, "Unknown status.");
    if (!nextStatuses(order).includes(status)) {
        throw new OrderError(409, `An order that is ${order.status} cannot become ${status}.`);
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE code = ?").run(status, code);
    return getOrder(db, code);
}

module.exports = { TITLES, STATUSES, nextStatuses, OrderError, listMenu, createOrder, getOrder, listActiveOrders, updateStatus };
