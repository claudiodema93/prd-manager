import { createFileRoute } from "@tanstack/react-router";
import DisplaySettingPage from "@/pages/settings/display-setting-page";

export const Route = createFileRoute("/settings/display")({
  component: DisplaySettingPage,
});
