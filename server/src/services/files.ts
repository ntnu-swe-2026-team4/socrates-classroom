import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { DB } from "../db";
import type { Config } from "../config";
import { one, run } from "../db";
import { fail, newId, nowIso } from "../http";

export const MAX_UPLOAD = 50 * 1024 * 1024;

export async function saveUpload(
  db: DB,
  config: Config,
  file: File,
  ownerId: string,
  scopeType: string,
  scopeId: string,
): Promise<any> {
  if (!(file instanceof File) || !file.name) fail(422, "file_missing");
  if (file.size > MAX_UPLOAD) fail(413, "file_too_large");
  const id = newId("f_");
  mkdirSync(config.uploadDir, { recursive: true });
  const fullPath = path.join(config.uploadDir, id);
  await Bun.write(fullPath, file);
  const row = {
    id,
    owner_id: ownerId,
    scope_type: scopeType,
    scope_id: scopeId,
    name: file.name.replace(/[\r\n]/g, "").slice(0, 255),
    mime_type: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
    size: file.size,
    path: fullPath,
    created_at: nowIso(),
  };
  run(
    db,
    `INSERT INTO files (id, owner_id, scope_type, scope_id, name, mime_type, size, path, created_at)
     VALUES ($id, $owner, $scopeType, $scopeId, $name, $mime, $size, $path, $at)`,
    {
      id, owner: ownerId, scopeType, scopeId, name: row.name,
      mime: row.mime_type, size: row.size, path: row.path, at: row.created_at,
    },
  );
  return row;
}

export function deleteFile(db: DB, fileId: string | null | undefined): void {
  if (!fileId) return;
  const row = one<any>(db, "SELECT * FROM files WHERE id = $id", { id: fileId });
  if (row) {
    try {
      unlinkSync(row.path);
    } catch {
      /* 檔案已經不在 */
    }
    run(db, "DELETE FROM files WHERE id = $id", { id: fileId });
  }
}

export function fileDownloadResponse(row: any): Response {
  if (!existsSync(row.path)) fail(404, "file_not_found");
  const file = Bun.file(row.path);
  return new Response(file, {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Length": String(row.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
