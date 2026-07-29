import { Navigate, Route, Routes } from "react-router-dom";
import { ClientLayout } from "./layouts/ClientLayout";
import { HostLayout } from "./layouts/HostLayout";
import { ClientConnectPage } from "./pages/client/ClientConnect";
import { ClientRetouchPage } from "./pages/client/ClientRetouch";
import { ClientUploadPage } from "./pages/client/ClientUpload";
import { MobileClientShell } from "./components/mobile/MobileClientShell";
import { MobilePhotoWallPage } from "./pages/client/MobilePhotoWall";
import { useMobileWebLayout } from "./hooks/useMobileWebLayout";
import { Startup } from "./pages/Startup";
import { ArchivePage } from "./pages/host/Archive";
import { EventsPage } from "./pages/host/Events";
import { ExportPage } from "./pages/host/Export";
import { ImportPage } from "./pages/host/Import";
import { OverviewPage } from "./pages/host/Overview";
import { PhotoWallPage } from "./pages/host/PhotoWall";
import { RetouchPage } from "./pages/host/Retouch";
import { SettingsPage } from "./pages/host/Settings";

export default function App() {
  const isMobileWeb = useMobileWebLayout();

  // Mobile web is a lightweight culling client only: it can reach the connect
  // page and the client photo wall, nothing else. Every host route, the
  // startup mode picker, and the desktop-only client routes (upload / retouch)
  // all redirect to the connect page or the photo wall.
  if (isMobileWeb) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/client" replace />} />
        <Route path="/client" element={<ClientConnectPage />} />
        <Route path="/client/photos" element={<MobileClientShell />}>
          <Route index element={<MobilePhotoWallPage />} />
        </Route>
        <Route path="/client/retouch" element={<Navigate to="/client/photos" replace />} />
        <Route path="/client/upload" element={<Navigate to="/client/photos" replace />} />
        <Route path="/host/*" element={<Navigate to="/client" replace />} />
        <Route path="*" element={<Navigate to="/client" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Startup />} />
      <Route path="/host" element={<HostLayout />}>
        <Route index element={<Navigate to="/host/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="photos" element={<PhotoWallPage />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="retouch" element={<RetouchPage />} />
        <Route path="done" element={<RetouchPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/client" element={<ClientConnectPage />} />
      <Route path="/client/photos" element={<ClientLayout />}>
        <Route index element={<PhotoWallPage mode="client" />} />
      </Route>
      <Route path="/client/retouch" element={<ClientLayout />}>
        <Route index element={<ClientRetouchPage />} />
      </Route>
      <Route path="/client/upload" element={<ClientLayout />}>
        <Route index element={<ClientUploadPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
