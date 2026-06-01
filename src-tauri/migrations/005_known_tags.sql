-- Known tag values discovered during scanning.
-- Drives filter chips in ROMs, Hacks, System Files tabs.
CREATE TABLE IF NOT EXISTS known_tags (
    tag_type TEXT NOT NULL,
    value    TEXT NOT NULL,
    PRIMARY KEY (tag_type, value)
);
