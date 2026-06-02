-- Migration 007: clean up language tags misclassified by the old permissive
-- is_language_tag() heuristic (any 2-3 char uppercase-first string).
-- Tags like Unl, Alt, CES, DSi, PAL, Wii, NP, etc. were landing in
-- known_tags as tag_type='language' instead of status/extra.

DELETE FROM known_tags WHERE tag_type = 'language' AND value NOT IN (
  'Af','Ar','Be','Bg','Ca','Cs','Cy','Da','De','El','En',
  'Eo','Es','Et','Eu','Fi','Fr','Ga','Gl','He','Hr','Hu',
  'Hy','Id','Is','It','Ja','Ka','Ko','Lt','Lv','Mk','Ms',
  'Mt','Nl','No','Pl','Pt','Ro','Ru','Sk','Sl','Sq','Sr',
  'Sv','Sw','Th','Tl','Tr','Uk','Ur','Vi','Yi','Zh',
  'Kw','Gd','Br','Co','Oc'
);

-- Pre-seed Unl and Alt as status tags so the Status filter chips are
-- immediately correct without requiring a manual rescan.
INSERT OR IGNORE INTO known_tags (tag_type, value) VALUES ('status', 'Unl');
INSERT OR IGNORE INTO known_tags (tag_type, value) VALUES ('status', 'Alt');
