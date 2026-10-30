DROP INDEX `idx_customers_code`;--> statement-breakpoint
ALTER TABLE `customers` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_customers_code_name` ON `customers` (`customer_code`,`folder_name`);