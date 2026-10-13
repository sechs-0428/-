import type { Preview, RestorePreview } from "./model";
let sessionToken = "";
export function setToken(token: string) {
  sessionToken = token;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (window.careDesktop)
    return (await window.careDesktop.request({
      path,
      method,
      body,
      token: sessionToken,
    })) as T;
  const response = await fetch(path, {
    method,
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `操作に失敗しました (${response.status})`);
  return data as T;
}
async function uploadPreview<T>(file: File, path: string): Promise<T> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("ファイルは10MB以内で選択してください。");
  if (window.careDesktop) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return (await window.careDesktop.requestBytes({
      path,
      base64: btoa(binary),
      token: sessionToken,
      filename: file.name,
    })) as T;
  }
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "ファイルを確認できませんでした。");
  return data;
}
export const previewWorkbook = (file: File) =>
  uploadPreview<Preview>(file, "/api/import/preview");
export const previewBackup = (file: File) =>
  uploadPreview<RestorePreview>(file, "/api/restore/preview");
export async function downloadBackup() {
  const data = await api<unknown>("/api/backup");
  const json = JSON.stringify(data, null, 2);
  const filename = `CareManager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (window.careDesktop)
    return window.careDesktop.saveBackup({ json, filename });
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
