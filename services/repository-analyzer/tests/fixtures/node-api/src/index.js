const express = require("express");

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(process.env.PORT || 3000);

module.exports = app;
