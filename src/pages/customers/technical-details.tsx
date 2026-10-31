import { useTranslation } from "react-i18next";

interface TechnicalDetailsProps {
  message?: string | null;
  path?: string | null;
}

/**
 * Technical backend details (raw messages and filesystem paths) are only
 * rendered inside a disclosure so the primary copy stays user friendly.
 */
export default function TechnicalDetails({
  message = null,
  path = null,
}: TechnicalDetailsProps) {
  const { t } = useTranslation();

  if (message === null && path === null) {
    return null;
  }

  return (
    <details className="text-muted-foreground mt-0.5 text-[0.625rem]">
      <summary className="cursor-pointer select-none">
        {t("customersTechnicalDetails")}
      </summary>
      {message === null ? null : (
        <p className="mt-1 font-mono break-words">{message}</p>
      )}
      {path === null ? null : (
        <p className="mt-0.5 font-mono break-all">{path}</p>
      )}
    </details>
  );
}
