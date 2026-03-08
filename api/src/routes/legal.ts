import { Router, Request, Response } from "express";

const router = Router();

router.get("/terms", (_req: Request, res: Response): void => {
  res.sendFile("terms.html", { root: "./public" });
});

router.get("/privacy", (_req: Request, res: Response): void => {
  res.sendFile("privacy.html", { root: "./public" });
});

export default router;
