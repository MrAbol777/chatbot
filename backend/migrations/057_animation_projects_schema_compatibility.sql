-- Backward-compatible repair for installations where the first Animation
-- Project table was created before `idea` and `stage` were persisted columns.
-- MariaDB 10.11 supports ADD COLUMN IF NOT EXISTS; existing project JSON is
-- used only to backfill these columns, never to replace the project snapshot.
ALTER TABLE animation_projects
  ADD COLUMN IF NOT EXISTS idea MEDIUMTEXT NULL AFTER title,
  ADD COLUMN IF NOT EXISTS stage ENUM('idea','questions','summary','scenario','characters','storyboard','video','completed','error') NULL AFTER idea;

UPDATE animation_projects
SET idea = CASE
  WHEN JSON_VALID(project) THEN COALESCE(
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(project, '$.userInput.idea')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(project, '$.idea')), ''),
    title
  )
  ELSE title
END
WHERE idea IS NULL OR TRIM(idea) = '';

UPDATE animation_projects
SET stage = CASE
  WHEN JSON_VALID(project)
    AND JSON_UNQUOTE(JSON_EXTRACT(project, '$.stage')) IN ('idea','questions','summary','scenario','characters','storyboard','video','completed','error')
    THEN JSON_UNQUOTE(JSON_EXTRACT(project, '$.stage'))
  ELSE 'idea'
END
WHERE stage IS NULL OR stage NOT IN ('idea','questions','summary','scenario','characters','storyboard','video','completed','error');

ALTER TABLE animation_projects
  MODIFY idea MEDIUMTEXT NOT NULL,
  MODIFY stage ENUM('idea','questions','summary','scenario','characters','storyboard','video','completed','error') NOT NULL DEFAULT 'idea';
