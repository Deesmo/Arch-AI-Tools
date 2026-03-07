"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.get("/terms", (_req, res) => {
    res.redirect(301, "/terms.html");
});
router.get("/privacy", (_req, res) => {
    res.redirect(301, "/privacy.html");
});
exports.default = router;
//# sourceMappingURL=legal.js.map