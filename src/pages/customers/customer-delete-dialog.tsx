import { Link } from "@tanstack/react-router";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { removeCustomer } from "@/actions/customers";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  CUSTOMER_ERROR_MESSAGE_KEYS,
  type CustomerErrorInfo,
  describeCustomerError,
} from "./customer-errors";
import type { CustomerSummary } from "./customer-types";
import TechnicalDetails from "./technical-details";

interface CustomerDeleteDialogProps {
  customer: CustomerSummary;
  onClose: () => void;
  onDeleted: () => void;
  trashDirectory: string | null;
}

export default function CustomerDeleteDialog({
  customer,
  onClose,
  onDeleted,
  trashDirectory,
}: CustomerDeleteDialogProps) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<CustomerErrorInfo | null>(null);
  const blocked = customer.articleCount > 0;
  const trashMissing = trashDirectory === null;
  const cannotDelete = blocked || trashMissing;
  const displayName = customer.name ?? customer.customerCode;

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    try {
      await removeCustomer(customer.folderPath);
      onDeleted();
    } catch (deleteError: unknown) {
      setError(describeCustomerError(deleteError));
    } finally {
      setDeleting(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!(open || deleting)) {
      onClose();
    }
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange} open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("customersDeleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>
                {t("customersDeleteDescription", {
                  code: customer.customerCode,
                  name: displayName,
                })}
              </p>
              {blocked ? (
                <p className="text-destructive">
                  {t("customersDeleteBlockedDescription", {
                    count: customer.articleCount,
                  })}
                </p>
              ) : null}
              {blocked || !trashMissing ? null : (
                <>
                  <p className="flex items-start gap-1.5">
                    <TriangleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>{t("customersDeleteTrashMissing")}</span>
                  </p>
                  <Button
                    asChild
                    className="mt-1 self-start"
                    size="sm"
                    variant="outline"
                  >
                    <Link onClick={onClose} to="/settings/folders">
                      {t("customersOpenFolders")}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <div
            className="border-destructive/40 bg-destructive/10 text-destructive flex flex-col gap-1 rounded-md border px-3 py-2 text-xs"
            role="alert"
          >
            <p className="font-medium">
              {t(CUSTOMER_ERROR_MESSAGE_KEYS[error.kind])}
            </p>
            <TechnicalDetails message={error.detail} />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            {t("customersFormCancel")}
          </AlertDialogCancel>
          <Button
            disabled={cannotDelete || deleting}
            onClick={handleDelete}
            variant="destructive"
          >
            {deleting ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : null}
            {deleting
              ? t("customersDeleteDeleting")
              : t("customersDeleteConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
