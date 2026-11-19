CREATE TABLE `articles` (
	`active_revision` text,
	`created_at` integer DEFAULT 0 NOT NULL,
	`customer_code` text NOT NULL,
	`customer_folder_path` text NOT NULL,
	`folder_mtime_ms` integer NOT NULL,
	`folder_name` text NOT NULL,
	`folder_path` text PRIMARY KEY NOT NULL,
	`metadata_json` text,
	`revision_count` integer DEFAULT 0 NOT NULL,
	`schema_version` integer NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_articles_customer` ON `articles` (`customer_folder_path`);--> statement-breakpoint
CREATE INDEX `idx_articles_name` ON `articles` (`folder_name`);