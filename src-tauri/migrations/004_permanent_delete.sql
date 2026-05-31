-- Initialize allow_permanent_delete setting (defaults off, opt-in only)
INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_permanent_delete', 'false');
