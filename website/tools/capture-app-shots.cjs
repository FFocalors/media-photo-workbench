// 生成官网用的产品界面截图：pnpm 先起 vite dev (5173)，再 node website/tools/capture-app-shots.cjs
const { chromium } = require("playwright");
const path = require("path");

const OUT = path.resolve(__dirname, "..", "assets", "shots");
const BASE = "http://127.0.0.1:5173";

const PHOTO = (id, w = 800) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

const POOL = [
  "photo-1461896836934-ffe607ba8211",
  "photo-1517649763962-0c623066013b",
  "photo-1526676037777-05a232554f77",
  "photo-1523580846011-d3a5bc25702b",
  "photo-1509062522246-3755977927d7",
  "photo-1541339907198-e08756dedf3f",
  "photo-1524178232363-1fb2b075b655",
  "photo-1523050854058-8df90110c9f1",
  "photo-1517486808906-6ca8b3f04846",
  "photo-1531482615713-2afd69097998",
  "photo-1516321318423-f06f85e504b3",
  "photo-1522202176988-66273c2fd55f",
  "photo-1543269865-cbf427effbad",
  "photo-1517245386807-bb43f82c33c4",
  "photo-1522071820081-009f0129c71c",
  "photo-1519389950473-47ba0277781c",
  "photo-1552664730-d307ca884978",
  "photo-1517048676732-d65bc937f952",
  "photo-1560439514-4e9645039924",
  "photo-1546519638-68e109498ffc",
  "photo-1571019613454-1cb2f99b2d8b",
  "photo-1574629810360-7efbbe195018",
  "photo-1577896851231-70ef18881754",
  "photo-1526506118085-60ce8714f8c5",
];

const NAMES = ["张一鸣", "李欣然", "王思远", "陈佳怡", "刘子轩", "赵晓月"];
const CAMERAS = ["NIKON Z 6", "Canon EOS R5", "SONY ILCE-7M4", "FUJIFILM X-T5", "NIKON D850"];
const CATS = ["开幕式", "田径", "赛场", "观众", "颁奖", "花絮"];
const STATUSES = ["publish", "publish", "edit", "edited", "archive", "unselected", "publish", "edit"];
const RATINGS = [5, 4, 3, 5, 0, 4, 2, 5, 3, 4, 5, 1];

const images = POOL.map((p, i) => ({
  id: `img_${(i + 1).toString(16).padStart(8, "0")}`,
  event_id: "evt-2026-sports",
  original_filename: `DSC_${2841 + i}.JPG`,
  stored_filename: `2026sports_20260510_cam${i % 3}_DSC_${2841 + i}.JPG`,
  thumb_url: PHOTO(p, 400),
  preview_url: PHOTO(p, 1600),
  file_size: 6200000 + i * 17321,
  width: 6048,
  height: 4024,
  shot_at: `2026-05-10T${String(8 + (i % 8)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00+08:00`,
  imported_at: "2026-05-10T19:20:00+08:00",
  rating: RATINGS[i % RATINGS.length],
  status: STATUSES[i % STATUSES.length],
  category: CATS[i % CATS.length],
  remark: "",
  photographer: NAMES[i % NAMES.length],
  camera_model: CAMERAS[i % CAMERAS.length],
  lens_model: "NIKKOR Z 70-200mm f/2.8",
  source_type: i % 4 === 0 ? "camera_ftp" : i % 3 === 0 ? "client_upload" : "host_import",
  uploaded_by_client_id: i % 3 === 0 ? "c1" : i % 4 === 0 ? "camera_ftp" : "host",
  uploaded_by_name: NAMES[i % NAMES.length],
  uploaded_by_role: "photographer",
  uploaded_at: "2026-05-10T19:20:00+08:00",
  edited_available: i % 5 === 0,
  original_exists: true,
  thumb_exists: true,
  preview_exists: true,
  edited_exists: i % 5 === 0,
  is_deleted: false,
  deleted_at: "",
  tags: ["运动会", "田径"],
}));

const EVENTS = [
  { id: "evt-2026-sports", name: "2026 春季运动会", slug: "2026sports", date: "2026-05-10", location: "东区田径场", status: "active", total_images: 428, selected_images: 96, created_at: "2026-05-01", updated_at: "2026-05-10" },
  { id: "evt-forum", name: "校园媒体论坛", slug: "campus_forum", date: "2026-04-26", location: "学术报告厅", status: "reviewing", total_images: 216, selected_images: 54, created_at: "2026-04-20", updated_at: "2026-04-28" },
  { id: "evt-open", name: "校园开放日", slug: "open_day", date: "2026-04-12", location: "主校区", status: "archived", total_images: 512, selected_images: 132, created_at: "2026-04-01", updated_at: "2026-04-15" },
];

const ok = (data) => ({ ok: true, data, error: null });

const TASKS = [
  { id: "t1", type: "import", eventId: "evt-2026-sports", title: "导入主机本地图片", status: "success", total: 428, finished: 428, successCount: 416, failedCount: 0, skippedCount: 12, errors: [], createdAt: "2026-05-10T18:40:00+08:00", finishedAt: "2026-05-10T18:52:00+08:00" },
  { id: "t2", type: "preview", eventId: "evt-2026-sports", title: "生成缩略图与预览图", status: "success", total: 428, finished: 428, successCount: 428, failedCount: 0, skippedCount: 0, errors: [], createdAt: "2026-05-10T18:52:00+08:00", finishedAt: "2026-05-10T19:01:00+08:00" },
  { id: "t3", type: "export", eventId: "evt-2026-sports", title: "导出 4 星以上发布图", status: "running", total: 96, finished: 61, successCount: 61, failedCount: 0, skippedCount: 0, errors: [], createdAt: "2026-05-10T19:35:00+08:00", finishedAt: "" },
];

const REPO = {
  exists: true,
  readable: true,
  writable: true,
  freeSpace: 412,
  totalSpace: 1000,
  freeSpaceBytes: 412000000000,
  totalSpaceBytes: 1000000000000,
  usedSpaceBytes: 588000000000,
  freeSpaceText: "412 GB",
  totalSpaceText: "1000 GB",
  path: "D:\\MediaPhotoWorkspace",
};

const HEALTH = {
  service: "media-photo-workbench",
  server: { port: 3030, configuredPort: 3030, status: "running" },
  database: { status: "ok", path: "D:\\MediaPhotoWorkbench\\data\\app.db" },
  repository: {
    configured: true,
    exists: true,
    readable: true,
    writable: true,
    freeSpace: 412,
    totalSpace: 1000,
    freeSpaceBytes: 412000000000,
    totalSpaceBytes: 1000000000000,
    usedSpaceBytes: 588000000000,
    freeSpaceText: "412 GB",
    totalSpaceText: "1000 GB",
    path: "D:\\MediaPhotoWorkspace",
  },
  network: {
    localhost: "http://localhost:3030",
    lanAddresses: [
      { name: "WLAN", address: "192.168.1.23", family: "IPv4", internal: false },
      { name: "以太网", address: "192.168.137.1", family: "IPv4", internal: false },
    ],
    hotspotAddress: "192.168.137.1",
  },
};

function build(url) {
  const u = url.replace("http://localhost:3030", "");
  if (/\/api\/health/.test(u)) return ok(HEALTH);
  if (/repository\/check/.test(u)) return ok(REPO);
  if (/\/api\/events\/[^/]+\/images/.test(u)) return ok({ items: images, total: images.length, page: 1, pageSize: 24 });
  if (/\/summary/.test(u)) return ok({ event_id: "evt-2026-sports", total_images: 428, edited_images: 96 });
  if (/\/api\/events\/[^/]+\/uploaders/.test(u)) return ok(NAMES.map((name, i) => ({ name, count: 4 + i * 3, clientId: `c${i}`, role: "photographer" })));
  if (/\/api\/events\/[^/]+/.test(u)) return ok(EVENTS[0]);
  if (/\/api\/events/.test(u)) return ok(EVENTS);
  if (/\/api\/tasks/.test(u)) return ok(TASKS);
  if (/clients\/online/.test(u)) return ok({
    clients: [
      { clientId: "c1", clientName: "修图电脑A", displayName: "修图电脑A", role: "client", connectedAt: "2026-05-10T19:02:00+08:00", lastSeenAt: "2026-05-10T19:41:00+08:00", address: "192.168.1.23" },
      { clientId: "c2", clientName: "摄影组1号", displayName: "摄影组1号", role: "client", connectedAt: "2026-05-10T19:05:00+08:00", lastSeenAt: "2026-05-10T19:40:00+08:00", address: "192.168.1.31" },
      { clientId: "c3", clientName: "指导老师 iPad", displayName: "指导老师 iPad", role: "client", connectedAt: "2026-05-10T19:12:00+08:00", lastSeenAt: "2026-05-10T19:38:00+08:00", address: "192.168.1.44" },
    ],
  });
  if (/settings/.test(u)) return ok({
    server: { port: 3030 },
    repository: { path: "D:\\MediaPhotoWorkspace" },
    database: { path: "D:\\MediaPhotoWorkbench\\data\\app.db", configuredPath: "D:\\MediaPhotoWorkbench\\data\\app.db", autoBackupEnabled: true, lastAutoBackupAt: "2026-05-10T18:00:00+08:00", autoBackupRetention: 10 },
    gallery: { batchSelectionBehavior: "keep" },
    cameraFtp: { provider: "iis", siteName: "MediaPhotoWorkbenchFTP", username: "camera", controlPort: 21, passivePortStart: 50000, passivePortEnd: 50100, running: true, activeEventId: "evt-2026-sports", passwordResetRequired: false, accountManaged: true },
  });
  if (/repository|storage|disk/.test(u)) return ok({ path: "D:\\MediaPhotoWorkspace", exists: true, readable: true, writable: true, freeBytes: 412000000000, totalBytes: 1000000000000 });
  return ok({});
}

async function shoot(page, url, file, { viewport = { width: 1600, height: 1000 }, fullPage = false, before = null, settle = 3500 } = {}) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => console.log("goto:", e.message));
  await page.waitForTimeout(2500);
  if (before) await before(page);
  await page.waitForTimeout(settle);
  const title = await page.locator("h1, h2").first().innerText().catch(() => "?");
  console.log("   page-title:", title.slice(0, 24));
  await page.screenshot({ path: path.join(OUT, file), fullPage });
  console.log("shot", file, "->", page.url());
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));

  await page.route("**/api/**", async (route) => {
    try {
      const body = build(route.request().url());
      console.log("SERVE", route.request().url().replace("http://localhost:3030", ""), "=>", JSON.stringify(body).slice(0, 70));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ok({})) });
    }
  });
  await page.route("**/socket.io/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "" }));

  const pickEvent = async (p) => {
    const sels = p.locator("select");
    const n = await sels.count();
    for (let i = 0; i < n; i++) {
      const text = await sels.nth(i).evaluate((el) => {
        const box = el.closest("div");
        return (box ? box.textContent : "") || "";
      }).catch(() => "");
      if (/活动/.test(text) && !/上传来源|星级|状态/.test(text.slice(0, 12))) {
        await sels.nth(i).selectOption({ index: 0 }).catch(() => {});
        await p.waitForTimeout(3000);
        return;
      }
    }
    await p.waitForTimeout(2000);
  };

  await shoot(page, "/host/photos", "photowall.png", { settle: 5500 });
  await shoot(page, "/host/overview", "overview.png", { settle: 3500 });
  await shoot(page, "/host/retouch", "retouch.png", { settle: 3500 });
  await shoot(page, "/host/export", "export.png", { settle: 3500 });
  await shoot(page, "/client/photos", "client-wall.png", { settle: 3500 });
  await shoot(page, "/host/import", "import.png", { settle: 4000 });
  await shoot(page, "/host/help/camera-ftp", "camera-ftp.png", { settle: 4000 });

  await browser.close();
})();
