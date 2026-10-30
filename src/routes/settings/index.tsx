import { createFileRoute } from "@tanstack/react-router";
import GeneralSettingPage from "@/pages/settings/general-setting-page";

export const Route = createFileRoute("/settings/")({
  component: GeneralSettingPage,
});
