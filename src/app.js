const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const express = require("express");
const orders = require("./orders");

// Builds the Express app around an open database. app.js at the project root
// starts it; the tests start it on a random port.
function createApp({ db, kitchenPassword }) {
    const app = express();
    const events = new EventEmitter();
    events.setMaxListeners(0);

    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "..", "views"));
    app.disable("x-powered-by");
    app.use(express.static(path.join(__dirname, "..", "public")));
    app.use(express.json({ limit: "20kb" }));

    const kitchenOnly = (req, res, next) => {
        if (!kitchenPassword) return res.status(503).send("Set KITCHEN_PASSWORD to use the kitchen screen.");
        const [scheme, encoded] = (req.headers.authorization || "").split(" ");
        const password = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
        const given = crypto.createHash("sha256").update(password).digest();
        const expected = crypto.createHash("sha256").update(kitchenPassword).digest();
        if (crypto.timingSafeEqual(given, expected)) return next();
        res.set("WWW-Authenticate", 'Basic realm="Kitchen"').status(401).send("Kitchen password required.");
    };

    const publish = (order) => events.emit("order", order);

    // Server-sent events: each client gets the order whenever it changes.
    const stream = (req, res, filter) => {
        res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.flushHeaders();
        const send = (order) => filter(order) && res.write(`data: ${JSON.stringify(order)}\n\n`);
        const ping = setInterval(() => res.write(": ping\n\n"), 25000);
        events.on("order", send);
        req.on("close", () => {
            clearInterval(ping);
            events.off("order", send);
        });
    };

    const menuForViews = () =>
        orders.listMenu(db).map((item) => ({ ...item, price: (item.priceCents / 100).toFixed(2) }));

    // Pages
    app.get("/", (req, res) => res.render("home", { page: "home", menu: menuForViews() }));
    app.get("/about", (req, res) => res.render("about", { page: "about" }));
    app.get("/orders/:code", (req, res) => {
        const order = orders.getOrder(db, req.params.code);
        if (!order) return res.status(404).render("not-found", { page: "not-found" });
        res.render("order", { page: "order", order, titles: orders.TITLES });
    });
    app.get("/kitchen", kitchenOnly, (req, res) => res.render("kitchen", { page: "kitchen" }));

    // Customer API
    app.get("/api/menu", (req, res) => res.json(orders.listMenu(db)));
    app.post("/api/orders", (req, res) => {
        const order = orders.createOrder(db, req.body);
        publish(order);
        res.status(201).json(order);
    });
    app.get("/api/orders/:code", (req, res) => {
        const order = orders.getOrder(db, req.params.code);
        if (!order) return res.status(404).json({ error: "Order not found." });
        res.json(order);
    });
    app.get("/api/orders/:code/events", (req, res) => {
        if (!orders.getOrder(db, req.params.code)) return res.status(404).end();
        stream(req, res, (order) => order.code === req.params.code);
    });

    // Kitchen API
    app.get("/api/kitchen/orders", kitchenOnly, (req, res) => res.json(orders.listActiveOrders(db)));
    app.patch("/api/kitchen/orders/:code", kitchenOnly, (req, res) => {
        const order = orders.updateStatus(db, req.params.code, req.body && req.body.status);
        publish(order);
        res.json(order);
    });
    app.get("/api/kitchen/events", kitchenOnly, (req, res) => stream(req, res, () => true));

    app.use((req, res) => {
        if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
        res.status(404).render("not-found", { page: "not-found" });
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err instanceof orders.OrderError) return res.status(err.status).json({ error: err.message });
        if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Send valid JSON." });
        if (err.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
        console.error(err);
        res.status(500).json({ error: "Something went wrong." });
    });

    return app;
}

module.exports = { createApp };
