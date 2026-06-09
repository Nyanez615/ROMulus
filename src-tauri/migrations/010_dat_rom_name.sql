-- Add rom_name column to dat_entries to store the actual ROM filename
-- (e.g. "Super Mario Bros (USA).nes") separately from the game title.
-- NULL means the entry was imported before this migration; re-import to populate.
ALTER TABLE dat_entries ADD COLUMN rom_name TEXT;

CREATE INDEX IF NOT EXISTS idx_dat_entries_rom_name ON dat_entries(rom_name);
