-- Add optional file_path column to comments so each pin can record which
-- artifact file was on screen when it was dropped. Lets the Comments tab
-- jump back to that file when the user clicks the pin row.

ALTER TABLE comments ADD COLUMN file_path TEXT;
