import { Moon } from "lucide-react";
import { toggleTheme } from "@/actions/theme";
import { Button } from "@/components/ui/button";

export default function ToggleTheme() {
  function handleToggle() {
    // The IPC call is asynchronous; log failures rather than letting them
    // surface as unhandled rejections.
    toggleTheme().catch((error: unknown) => {
      console.error("Failed to toggle the theme:", error);
    });
  }

  return (
    <Button
      aria-label="Toggle theme"
      onClick={handleToggle}
      size="icon"
      title="Toggle theme"
    >
      <Moon size={16} />
    </Button>
  );
}
