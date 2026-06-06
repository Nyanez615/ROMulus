-- Remove obsolete filter-settings keys from the KV settings table.
-- filter_remove_unofficial and filter_keep_unofficial_as_fallback were replaced
-- by unified prune behavior in v0.2.8 — all file categories are now treated
-- identically (keep the preferred-language variant, delete the rest).
DELETE FROM settings WHERE key IN ('filter_remove_unofficial', 'filter_keep_unofficial_as_fallback');
