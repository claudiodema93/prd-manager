import { RouterProvider } from "@tanstack/react-router";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { updateAppLanguage } from "./actions/language";
import { syncTheme } from "./actions/theme";
import { router } from "./utils/routes";
import "./localization/i18n";

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
