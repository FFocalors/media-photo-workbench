import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initMobileWebAttribute } from "./hooks/useMobileWebLayout";
import "./styles.css";

// Set `<html data-mobile-web>` before first paint so the mobile CSS overrides
// apply without a flash of the desktop min-width. No-op on Electron/desktop.
initMobileWebAttribute();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
