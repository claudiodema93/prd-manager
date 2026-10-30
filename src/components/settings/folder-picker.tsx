import { FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FolderKey } from "@/types/preferences";

interface FolderPickerProps {
  browseLabel: string;
  clearLabel: string;
  description: string;
  disabled?: boolean;
  emptyLabel: string;
  folderKey: FolderKey;
  label: string;
  onBrowse: (key: FolderKey) => void;
  onClear: (key: FolderKey) => void;
  value: string | null;
}

export default function FolderPicker({
  browseLabel,
  clearLabel,
  description,
  disabled = false,
  emptyLabel,
  folderKey,
  label,
  onBrowse,
  onClear,
  value,
}: FolderPickerProps) {
  function handleBrowseClick() {
    onBrowse(folderKey);
  }

  function handleClearClick() {
    onClear(folderKey);
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium">{label}</h4>
      <p className="text-muted-foreground text-sm">{description}</p>
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          disabled={disabled}
          placeholder={emptyLabel}
          readOnly
          value={value ?? ""}
        />
        <Button
          aria-label={`${browseLabel} ${label}`}
          disabled={disabled}
          onClick={handleBrowseClick}
          size="sm"
          type="button"
          variant="outline"
        >
          <FolderOpen />
          {browseLabel}
        </Button>
        {value === null ? null : (
          <Button
            aria-label={`${clearLabel} ${label}`}
            disabled={disabled}
            onClick={handleClearClick}
            size="sm"
            type="button"
            variant="ghost"
          >
            <X />
            {clearLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
