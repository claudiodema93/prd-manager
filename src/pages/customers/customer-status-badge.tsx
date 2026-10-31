import { cn } from "cn";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { CustomerStatus } from "@/constants/customers";
import type { TranslationKey } from "@/localization/resources/it";

interface StatusConfig {
  className: string;
  Icon: LucideIcon;
  labelKey: TranslationKey;
}

const STATUS_CONFIG: Record<CustomerStatus, StatusConfig> = {
  error: {
    className:
      "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20",
    Icon: CircleX,
    labelKey: "customersStatusError",
  },
  ok: {
    className:
      "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: CircleCheck,
    labelKey: "customersStatusOk",
  },
  warning: {
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    Icon: CircleAlert,
    labelKey: "customersStatusWarning",
  },
};

export default function CustomerStatusBadge({
  status,
}: {
  status: CustomerStatus;
}) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];

  return (
    <Badge className={cn("gap-1", config.className)} variant="outline">
      <config.Icon aria-hidden="true" />
      <span>{t(config.labelKey)}</span>
    </Badge>
  );
}
