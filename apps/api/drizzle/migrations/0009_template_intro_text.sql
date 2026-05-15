-- Add intro_text column to templates: the composer intro shown to users
-- when they create a new project from this template (claude.ai/design
-- bundle Bu8zJzmd save_as_template tool surfaces this as the third schema
-- field). Existing rows keep NULL.

ALTER TABLE templates ADD COLUMN intro_text TEXT;
