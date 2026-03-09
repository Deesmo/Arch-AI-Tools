"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// Redirect bare /legal → /legal/terms
router.get("/", (_req, res) => {
    res.redirect(301, "/legal/terms");
});
router.get("/terms", (_req, res) => {
    res.sendFile("terms.html", { root: "./public" });
});
router.get("/privacy", (_req, res) => {
    res.sendFile("privacy.html", { root: "./public" });
});
exports.default = router;
//# sourceMappingURL=legal.js.map