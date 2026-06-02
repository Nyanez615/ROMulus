-- Remove stale status entries for flags that belong in the category bucket.
-- INSERT OR IGNORE in upsert_known_tags never overwrote these if they were
-- written before CATEGORY_FLAGS was added to the scanner.
DELETE FROM known_tags WHERE tag_type = 'status' AND value IN ('Pirate','Unl','Aftermarket','Hack');
INSERT OR IGNORE INTO known_tags (tag_type, value) VALUES
  ('category','Pirate'),
  ('category','Unl'),
  ('category','Aftermarket'),
  ('category','Hack');
