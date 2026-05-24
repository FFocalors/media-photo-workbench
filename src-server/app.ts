import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import healthRouter from "./routes/health";
import settingsRouter from "./routes/settings";
import repositoryRouter from "./routes/repository";
import eventsRouter from "./routes/events";
import imagesRouter from "./routes/images";
import editPackagesRouter from "./routes/editPackages";
import exportsRouter from "./routes/exports";
import archivedEventsRouter from "./routes/archivedEvents";
import tasksRouter from "./routes/tasks";
import downloadPackagesRouter from "./routes/downloadPackages";
import clientsRouter from "./routes/clients";

export interface CreateAppOptions {
  frontendDistPath?: string;
  serveFrontend?: boolean;
}

/**
 * 创建 Express 应用实例。
 */
export function createApp(options: CreateAppOptions = {}): express.Application {
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
  app.use("/api/exports", exportsRouter);
  app.use("/api/archived-events", archivedEventsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/download-packages", downloadPackagesRouter);
  app.use("/api/clients", clientsRouter);

  const frontendDistPath = options.serveFrontend === false
    ? null
    : resolveFrontendDistPath(options.frontendDistPath);

  if (frontendDistPath) {
    app.use(express.static(frontendDistPath, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
        next();
        return;
      }

      res.sendFile(path.join(frontendDistPath, "index.html"));
    });
  }

  return app;
}

function resolveFrontendDistPath(frontendDistPath?: string): string | null {
  const candidates = [
    frontendDistPath,
    path.resolve(process.cwd(), "dist"),
    path.resolve(__dirname, "../dist")
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}
