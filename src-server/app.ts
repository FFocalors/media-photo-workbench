import express from "express";
import cors from "cors";
import healthRouter from "./routes/health";
import settingsRouter from "./routes/settings";
import repositoryRouter from "./routes/repository";
import eventsRouter from "./routes/events";
import imagesRouter from "./routes/images";
import editPackagesRouter from "./routes/editPackages";

/**
 * 创建 Express 应用实例。
 */
export function createApp(): express.Application {
  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json());

  // 路由挂载
  app.use("/api/health", healthRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/repository", repositoryRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/images", imagesRouter);
  app.use("/api/edit-packages", editPackagesRouter);

  return app;
}
