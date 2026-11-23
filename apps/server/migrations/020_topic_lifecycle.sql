ALTER TABLE topics ADD COLUMN deleted_at TEXT;

UPDATE topics
SET axes = CASE
  WHEN json_valid(axes) AND json_type(axes) = 'array' AND json_array_length(axes) > 0 THEN (
    SELECT json_group_array(
      json_object(
        'name', json_extract(value, '$.name'),
        'left', json_extract(value, '$.left'),
        'right', json_extract(value, '$.right')
      )
    )
    FROM json_each(topics.axes)
  )
  ELSE axes
END;

UPDATE activities
SET topic_id = COALESCE((
  SELECT keeper.id
  FROM topics dup
  JOIN topics keeper
    ON keeper.classroom_id IS dup.classroom_id
   AND keeper.owner_id IS dup.owner_id
   AND keeper.title = dup.title
   AND keeper.statement = dup.statement
   AND keeper.axes = dup.axes
  WHERE dup.id = activities.topic_id
    AND (dup.classroom_id IS NOT NULL OR dup.owner_id IS NOT NULL)
  ORDER BY keeper.created_at, keeper.id
  LIMIT 1
), topic_id)
WHERE EXISTS (
  SELECT 1 FROM topics dup
  WHERE dup.id = activities.topic_id
    AND (dup.classroom_id IS NOT NULL OR dup.owner_id IS NOT NULL)
);

UPDATE topics
SET copied_from = COALESCE((
  SELECT keeper.id
  FROM topics dup
  JOIN topics keeper
    ON keeper.classroom_id IS dup.classroom_id
   AND keeper.owner_id IS dup.owner_id
   AND keeper.title = dup.title
   AND keeper.statement = dup.statement
   AND keeper.axes = dup.axes
  WHERE dup.id = topics.copied_from
    AND (dup.classroom_id IS NOT NULL OR dup.owner_id IS NOT NULL)
  ORDER BY keeper.created_at, keeper.id
  LIMIT 1
), copied_from)
WHERE copied_from IS NOT NULL;

DELETE FROM topics
WHERE classroom_id IS NOT NULL
  AND id <> (
    SELECT keeper.id FROM topics keeper
    WHERE keeper.classroom_id = topics.classroom_id
      AND keeper.title = topics.title
      AND keeper.statement = topics.statement
      AND keeper.axes = topics.axes
    ORDER BY keeper.created_at, keeper.id
    LIMIT 1
  );

DELETE FROM topics
WHERE classroom_id IS NULL
  AND owner_id IS NOT NULL
  AND id <> (
    SELECT keeper.id FROM topics keeper
    WHERE keeper.owner_id = topics.owner_id
      AND keeper.title = topics.title
      AND keeper.statement = topics.statement
      AND keeper.axes = topics.axes
    ORDER BY keeper.created_at, keeper.id
    LIMIT 1
  );

CREATE UNIQUE INDEX topics_classroom_content ON topics(classroom_id, title, statement, axes)
  WHERE classroom_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX topics_personal_content ON topics(owner_id, title, statement, axes)
  WHERE classroom_id IS NULL AND owner_id IS NOT NULL AND deleted_at IS NULL;
