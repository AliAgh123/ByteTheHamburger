const path = require("node:path");
const { openDatabase } = require("./src/db");
const { createApp } = require("./src/app");

const production = process.env.NODE_ENV === "production";
let kitchenPassword = process.env.KITCHEN_PASSWORD;
if (!kitchenPassword && !production) {
    kitchenPassword = "kitchen";
    console.warn('KITCHEN_PASSWORD is not set; the kitchen screen uses "kitchen" for local development.');
}

const db = openDatabase(process.env.DATABASE_PATH || path.join(__dirname, "data", "bytetheburger.db"));
const app = createApp({ db, kitchenPassword });

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server started on port ${port}.`);
});
