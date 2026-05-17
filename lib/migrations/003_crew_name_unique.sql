-- Guard the lazy crew-row insert in lib/crew.js against duplicates.
-- Before this index, resolve() did a SELECT-then-INSERT — two concurrent
-- calls for the same name could both miss the SELECT and both INSERT.
-- COLLATE NOCASE keeps the constraint case-insensitive to match the lookup.

CREATE UNIQUE INDEX crew_name_unique ON crew(name COLLATE NOCASE);
