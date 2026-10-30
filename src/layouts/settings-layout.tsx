import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import SettingsNav from "@/components/settings/settings-nav";

export default function SettingsLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("settings")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("settingsDescription")}
        </p>
      </header>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <aside className="md:w-48 md:shrink-0">
          <SettingsNav />
        </aside>
        <section className="min-w-0 flex-1">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
