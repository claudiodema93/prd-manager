CREATE TABLE `customers` (
	`folder_path` text PRIMARY KEY NOT NULL,
	`customer_code` text NOT NULL,
	`folder_name` text NOT NULL,
	`name` text,
	`schema_version` integer,
	`article_schema_version` integer,
	`revision_schema_version` integer,
	`folder_mtime_ms` integer NOT NULL,
	`metadata_json` text,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_code` ON `customers` (`customer_code`);