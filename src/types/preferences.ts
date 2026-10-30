export const FOLDER_KEYS = [
  "articlesDirectory",
  "issuesDirectory",
  "trashDirectory",
] as const;

export type FolderKey = (typeof FOLDER_KEYS)[number];

export interface FolderPreferences {
  articlesDirectory: string | null;
  issuesDirectory: string | null;
  trashDirectory: string | null;
}

export const DEFAULT_FOLDER_PREFERENCES: FolderPreferences = {
  articlesDirectory: null,
  issuesDirectory: null,
  trashDirectory: null,
};
