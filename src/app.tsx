import { RouterProvider } from "@tanstack/react-router";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { updateAppLanguage } from "./actions/language";
import { syncTheme } from "./actions/theme";
import { router } from "./utils/routes";
import "./localization/i18n";

// Apply the effective scheme before React mounts. The main process sets
// `nativeTheme.themeSource` from the stored preference before creating the
// window, so `prefers-color-scheme` already reflects an explicit mode and the
// first paint is not briefly light.
if (typeof window.matchMedia === "function") {
  document.documentElement.classList.toggle(
    "dark",
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export default function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    // Theme synchronisation talks to the main process; surface failures instead
    // of leaving the effect with an unhandled rejection.
    syncTheme().catch((error: unknown) => {
      console.error("Failed to apply the stored theme:", error);
    });
    updateAppLanguage(i18n).catch((error: unknown) => {
      console.error("Failed to apply the stored language:", error);
    });
  }, [i18n]);

  return <RouterProvider router={router} />;
}

const container = document.querySelector("#app");
if (!container) {
  throw new Error('Root element with id "app" not found');
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
