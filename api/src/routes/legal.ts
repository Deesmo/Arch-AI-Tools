import { Router, Request, Response } from "express";

const router = Router();

router.get("/terms", (_req: Request, res: Response): void => {
  res.redirect(301, "/terms.html");
});

router.get("/privacy", (_req: Request, res: Response): void => {
  res.redirect(301, "/privacy.html");
});

export default router;
