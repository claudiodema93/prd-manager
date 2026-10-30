import { createFileRoute } from "@tanstack/react-router";
import CustomersPage from "@/pages/customers/customers-page";

export const Route = createFileRoute("/customers")({
  component: CustomersPage,
});
