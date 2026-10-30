import { createFileRoute } from "@tanstack/react-router";
import FolderSettingPage from "@/pages/settings/folder-setting-page";

export const Route = createFileRoute("/settings/folders")({
  component: FolderSettingPage,
});
