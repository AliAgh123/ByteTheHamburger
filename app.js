const express = require("express");
const ejs = require("ejs");

const app = express();

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use("/dir/", express.static(__dirname));

app.get("/", (req, res) => {
    // res.sendFile(__dirname + "/index.html");
    res.render("home");
});

app.get("/about", (req, res) => {
    res.render("about");
})

app.listen(3000, () => {
    console.log("Server started on port 3000.");
});