const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SEED_MENU = [
    { name: "The Byte", tag: "Signature", price: 950, description: "Beef patty, cheddar, tomato, butter lettuce and house sauce on a sesame bun." },
    { name: "Double Byte", tag: "Hungry", price: 1250, description: "Two patties, double cheddar, pickles and caramelised onion." },
    { name: "Garden Byte", tag: "Vegetarian", price: 900, description: "Grilled halloumi, roasted pepper, tomato and herb mayo." },
    { name: "Buffalo Wings", tag: "Side", price: 699, description: "Six wings tossed in buffalo sauce, with blue cheese dip." },
    { name: "Crispy Fries", tag: "Side", price: 350, description: "Double-fried and salted, with ketchup or garlic aioli." },
    { name: "Cola", tag: "Drink", price: 150, description: "Ice cold, 330 ml can." },
];

// Each migration runs once, in order. PRAGMA user_version records how many
// have run, so an existing database is upgraded in place.
const MIGRATIONS = [
    `
    CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        tag TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents > 0),
        available INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        fulfilment TEXT NOT NULL CHECK (fulfilment IN ('pickup', 'table')),
        table_number INTEGER,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'received',
        total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
    `,
    // Delivery orders and the payment method. SQLite cannot change a CHECK
    // constraint, so the orders table is rebuilt.
    `
    CREATE TABLE orders_new (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        fulfilment TEXT NOT NULL CHECK (fulfilment IN ('pickup', 'table', 'delivery')),
        table_number INTEGER,
        phone TEXT,
        address TEXT,
        payment TEXT NOT NULL CHECK (payment IN ('cash_at_counter', 'cash_on_delivery')),
        delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'received',
        total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO orders_new (id, code, customer_name, fulfilment, table_number, payment, note, status, total_cents, created_at, updated_at)
        SELECT id, code, customer_name, fulfilment, table_number, 'cash_at_counter', note, status, total_cents, created_at, updated_at FROM orders;
    DROP TABLE orders;
    ALTER TABLE orders_new RENAME TO orders;
    CREATE INDEX orders_status ON orders(status);
    `,
];

// Opens (or creates) the database, applies pending migrations and seeds the
// menu once. Pass ":memory:" for tests.
function openDatabase(file) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL;");

    // Foreign keys must be off while a table they point at is rebuilt.
    db.exec("PRAGMA foreign_keys = OFF;");
    const { user_version: version } = db.prepare("PRAGMA user_version").get();
    MIGRATIONS.slice(version).forEach((sql, i) => {
        db.exec("BEGIN");
        try {
            db.exec(sql);
            db.exec(`PRAGMA user_version = ${version + i + 1}`);
            db.exec("COMMIT");
        } catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    });
    db.exec("PRAGMA foreign_keys = ON;");

    const { count } = db.prepare("SELECT COUNT(*) AS count FROM menu_items").get();
    if (count === 0) {
        const insert = db.prepare(
            "INSERT INTO menu_items (name, tag, description, price_cents, position) VALUES (?, ?, ?, ?, ?)"
        );
        SEED_MENU.forEach((item, i) => insert.run(item.name, item.tag, item.description, item.price, i));
    }
    return db;
}

module.exports = { openDatabase };
