import { Router } from "express";
const router = Router();
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
router.get("/aup", (_req, res) => {
    res.sendFile("aup.html", { root: "./public" });
});
router.get("/refund", (_req, res) => {
    res.sendFile("refund.html", { root: "./public" });
});
router.get("/security", (_req, res) => {
    res.sendFile("security.html", { root: "./public" });
});
router.get("/retention", (_req, res) => {
    res.sendFile("retention.html", { root: "./public" });
});
router.get("/subprocessors", (_req, res) => {
    res.sendFile("subprocessors.html", { root: "./public" });
});
export default router;
//# sourceMappingURL=legal.js.map