import type { Db } from "../db/d1";
import { one, run } from "../db/d1";
import type { Env } from "../env";
import { fail, newId, nowIso } from "../http";

export const MAX_UPLOAD = 50 * 1024 * 1024;

/** 上傳存 R2（key = 檔案 id）；D1 記 metadata。 */
export async function saveUpload(
  db: Db,
  env: Env,
  file: File,
  ownerId: string,
  scopeType: string,
  scopeId: string,
): Promise<any> {
  if (!(file instanceof File) || !file.name) fail(422, "file_missing");
  if (file.size > MAX_UPLOAD) fail(413, "file_too_large");
  const id = newId("f_");
  await env.UPLOADS.put(id, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  const row = {
    id,
    owner_id: ownerId,
    scope_type: scopeType,
    scope_id: scopeId,
    name: file.name.replace(/[\r\n]/g, "").slice(0, 255),
    mime_type: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
    size: file.size,
    path: id, // R2 key
    created_at: nowIso(),
  };
  try {
    await run(
      db,
      `INSERT INTO files (id, owner_id, scope_type, scope_id, name, mime_type, size, path, created_at)
       VALUES ($id, $owner, $scopeType, $scopeId, $name, $mime, $size, $path, $at)`,
      {
        id, owner: ownerId, scopeType, scopeId, name: row.name,
        mime: row.mime_type, size: row.size, path: row.path, at: row.created_at,
      },
    );
  } catch (error) {
    // DB 寫入失敗時把已上傳的物件刪掉，不留孤兒
    try {
      await env.UPLOADS.delete(id);
    } catch {
      /* 物件已經不在 */
    }
    throw error;
  }
  return row;
}

export async function deleteFile(db: Db, env: Env, fileId: string | null | undefined): Promise<void> {
  if (!fileId) return;
  const row = await one<{ id: string; path: string }>(db, "SELECT * FROM files WHERE id = $id", { id: fileId });
  if (row) {
    try {
      await env.UPLOADS.delete(row.path);
    } catch {
      /* 檔案已經不在 */
    }
    await run(db, "DELETE FROM files WHERE id = $id", { id: fileId });
  }
}

/** 下載：從 R2 串流（權限檢查在路由層）。 */
export async function fileDownloadResponse(env: Env, row: { path: string; mime_type: string; size: number; name: string }): Promise<Response> {
  const object = await env.UPLOADS.get(row.path);
  if (!object) fail(404, "file_not_found");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      ...(row.size ? { "Content-Length": String(row.size) } : {}),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
