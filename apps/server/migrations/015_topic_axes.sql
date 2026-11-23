ALTER TABLE topics ADD COLUMN axes TEXT NOT NULL DEFAULT '[]';

UPDATE topics SET axes = '[{"name":"拉桿的理由","left":"看結果：救多數","right":"看手段：不能親手害人"}]'
  WHERE owner_id IS NULL AND title = '電車難題：你會拉桿嗎？';
UPDATE topics SET axes = '[{"name":"契約與人情","left":"契約應該被遵守","right":"人情與孩子優先"}]'
  WHERE owner_id IS NULL AND title = '代理孕母的承諾';
UPDATE topics SET axes = '[{"name":"權利的來源","left":"看表現：會痛就該顧慮","right":"看本質：表現不等於擁有"}]'
  WHERE owner_id IS NULL AND title = 'AI 應該有權利嗎？';

UPDATE topics SET axes = (SELECT s.axes FROM topics s WHERE s.id = topics.copied_from)
  WHERE axes = '[]'
    AND copied_from IN (SELECT id FROM topics WHERE owner_id IS NULL AND classroom_id IS NULL AND axes <> '[]');
