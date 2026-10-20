# Byte The Burger

A burger restaurant website. Customers order from the menu and choose free delivery, pickup at the counter, or service at their table. They follow the order live. Payment is cash: to the driver on delivery, or at the counter. The kitchen works from a live board.

The home page opens with a 3D burger whose ingredients are scattered across the screen. Scrolling flies them in and stacks them, one layer at a time.

## Run it

You need Node.js 22.13 or newer, which includes the built-in SQLite module.

```sh
npm install
npm run dev        # restarts on file changes
```

Open http://localhost:3000. If port 3000 is taken, start it with `PORT=4000 npm run dev`.

The database is created at `data/bytetheburger.db` on the first start, with the menu already in it.

## Pages

| Path | What it is |
| --- | --- |
| `/` | Home page with the scroll-built burger, the menu and the cart |
| `/orders/:code` | Live status of one order |
| `/kitchen` | Kitchen board, protected by a password |
| `/about` | About page |

The kitchen password comes from `KITCHEN_PASSWORD`. Without it, local development uses `kitchen`. With `NODE_ENV=production` and no password set, the kitchen stays locked.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/menu` | Available menu items, prices in cents |
| `POST /api/orders` | Place an order: `{ name, fulfilment: "delivery", "pickup" or "table", address and phone (delivery), tableNumber (table), note?, items: [{ id, quantity }] }` |
| `GET /api/orders/:code` | One order |
| `GET /api/orders/:code/events` | Server-sent events whenever that order changes |
| `GET /api/kitchen/orders` | Orders that are received, cooking, ready or on the way (kitchen password) |
| `PATCH /api/kitchen/orders/:code` | Move an order on: `{ status }` (kitchen password) |
| `GET /api/kitchen/events` | Server-sent events for every order change (kitchen password) |

The server computes every price from the database and ignores prices sent by the browser. Order codes are random, so a customer cannot open someone else's order by guessing. An order moves `received` to `cooking` to `ready`. A delivery order then goes `out_for_delivery` and `delivered`; a pickup or table order becomes `collected`. The kitchen can cancel an order before it is ready.

Delivery is free (`DELIVERY_FEE_CENTS` in `src/orders.js`). The payment method follows from how the order is fulfilled: `cash_on_delivery` for delivery, `cash_at_counter` otherwise.

## Code

- `app.js` reads the settings and starts the server.
- `src/app.js` has the routes, the kitchen password check and the live updates.
- `src/orders.js` validates orders and moves them between statuses.
- `src/db.js` applies the database migrations in order (tracked with `PRAGMA user_version`) and seeds the menu.
- `public/js/site.js` has the 3D burger (Three.js), the scroll animation (GSAP ScrollTrigger) and smooth scrolling (Lenis).
- `public/js/cart.js`, `order.js` and `kitchen.js` drive the cart, the order page and the kitchen board.

## Tests

```sh
npm test
```

The tests start the app on a random port with an in-memory database. They cover the menu, price handling, validation, delivery and payment, the kitchen password, status changes, the live updates and upgrading an older database.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATABASE_PATH` | `data/bytetheburger.db` | SQLite file |
| `KITCHEN_PASSWORD` | `kitchen` outside production | Password for the kitchen board |
| `NODE_ENV` | | Set to `production` to require `KITCHEN_PASSWORD` |
