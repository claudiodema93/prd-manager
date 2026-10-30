ALTER TABLE `customers` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE customers SET search_text = lower(customer_code || ' ' || folder_name || ' ' || coalesce(name, ''));
