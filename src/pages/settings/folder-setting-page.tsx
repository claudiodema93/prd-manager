import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openDirectoryDialog } from "@/actions/dialog";
import { getFolderPreferences, setFolderPreference } from "@/actions/folders";
import FolderPicker from "@/components/settings/folder-picker";
import type { TranslationKey } from "@/localization/resources/it";
import {
  DEFAULT_FOLDER_PREFERENCES,
  FOLDER_KEYS,
  type FolderKey,
  type FolderPreferences,
} from "@/types/preferences";

interface FolderField {
  descriptionKey: TranslationKey;
  labelKey: TranslationKey;
}

const FOLDER_FIELDS: Record<FolderKey, FolderField> = {
  articlesDirectory: {
    descriptionKey: "folderArticlesDescription",
    labelKey: "folderArticlesLabel",
  },
  issuesDirectory: {
    descriptionKey: "folderIssuesDescription",
    labelKey: "folderIssuesLabel",
  },
  trashDirectory: {
    descriptionKey: "folderTrashDescription",
    labelKey: "folderTrashLabel",
  },
};

interface FolderSettingRowProps {
  folderKey: FolderKey;
  folders: FolderPreferences;
  onBrowse: (key: FolderKey) => void;
  onClear: (key: FolderKey) => void;
  pendingKey: FolderKey | null;
}

function FolderSettingRow({
  folderKey,
  folders,
  onBrowse,
  onClear,
  pendingKey,
}: FolderSettingRowProps) {
  const { t } = useTranslation();
  const field = FOLDER_FIELDS[folderKey];

  return (
    <FolderPicker
      browseLabel={t("folderBrowse")}
      clearLabel={t("folderClear")}
      description={t(field.descriptionKey)}
      disabled={pendingKey !== null}
      emptyLabel={t("folderNotSelected")}
      folderKey={folderKey}
      label={t(field.labelKey)}
      onBrowse={onBrowse}
      onClear={onClear}
      value={folders[folderKey]}
    />
  );
}

export default function FolderSettingPage() {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderPreferences>({
    ...DEFAULT_FOLDER_PREFERENCES,
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<FolderKey | null>(null);

  useEffect(() => {
    let active = true;

    getFolderPreferences()
      .then((preferences) => {
        if (active) {
          setFolders(preferences);
        }
      })
      .catch((loadError: unknown) => {
        console.error("Failed to load folder preferences:", loadError);

        if (active) {
          setError(t("folderLoadError"));
        }
      });

    return () => {
      active = false;
    };
  }, [t]);

  async function browseFolder(key: FolderKey): Promise<void> {
    setPendingKey(key);
    setError(null);

    try {
      const result = await openDirectoryDialog({
        buttonLabel: t("folderChoose"),
        defaultPath: folders[key] ?? undefined,
        title: t("folderPickerTitle"),
      });
      const [selectedPath] = result.filePaths;

      if (result.canceled || !selectedPath) {
        return;
      }

      const updated = await setFolderPreference(key, selectedPath);
      setFolders(updated);
    } catch (browseError: unknown) {
      console.error("Failed to save the selected folder:", browseError);
      setError(t("folderSaveError"));
    } finally {
      setPendingKey(null);
    }
  }

  async function clearFolder(key: FolderKey): Promise<void> {
    setPendingKey(key);
    setError(null);

    try {
      const updated = await setFolderPreference(key, null);
      setFolders(updated);
    } catch (clearError: unknown) {
      console.error("Failed to clear the folder preference:", clearError);
      setError(t("folderSaveError"));
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("foldersTitle")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("foldersDescription")}
        </p>
      </header>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-8">
        {FOLDER_KEYS.map((key) => (
          <FolderSettingRow
            folderKey={key}
            folders={folders}
            key={key}
            onBrowse={browseFolder}
            onClear={clearFolder}
            pendingKey={pendingKey}
          />
        ))}
      </div>
    </div>
  );
}
