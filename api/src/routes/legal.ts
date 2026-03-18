import { Router, Request, Response } from "express";

const router = Router();

// Redirect bare /legal → /legal/terms
router.get("/", (_req: Request, res: Response): void => {
  res.redirect(301, "/legal/terms");
});

router.get("/terms", (_req: Request, res: Response): void => {
  res.sendFile("terms.html", { root: "./public" });
});

router.get("/privacy", (_req: Request, res: Response): void => {
  res.sendFile("privacy.html", { root: "./public" });
});

router.get("/aup", (_req: Request, res: Response): void => {
  res.sendFile("aup.html", { root: "./public" });
});

router.get("/refund", (_req: Request, res: Response): void => {
  res.sendFile("refund.html", { root: "./public" });
});

router.get("/security", (_req: Request, res: Response): void => {
  res.sendFile("security.html", { root: "./public" });
});

router.get("/retention", (_req: Request, res: Response): void => {
  res.sendFile("retention.html", { root: "./public" });
});

router.get("/subprocessors", (_req: Request, res: Response): void => {
  res.sendFile("subprocessors.html", { root: "./public" });
});

export default router;
