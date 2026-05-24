import { Router } from "express";
import { getOnlineClients } from "../realtime/socket";
import { sendSuccess } from "../utils/response";

const router = Router();

router.get("/online", (_req, res) => {
  sendSuccess(res, {
    clients: getOnlineClients()
  });
});

export default router;
