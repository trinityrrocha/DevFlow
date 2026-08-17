const SAFE_BACKUP_FILENAME = /^devflow-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.dfbackup$/;

export function attachmentFilename(contentDisposition, fallback) {
  const header = String(contentDisposition || '');
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = header.match(/filename="([^"]+)"/i)?.[1];
  let candidate = fallback;
  try { candidate = encoded ? decodeURIComponent(encoded) : quoted || fallback; }
  catch { candidate = fallback; }
  return SAFE_BACKUP_FILENAME.test(candidate || '') ? candidate : fallback;
}

export async function normalizeBlobError(error) {
  const payload = error?.response?.data;
  if (payload && typeof payload.text === 'function') {
    try { error.response.data = JSON.parse(await payload.text()); }
    catch { /* keep the original HTTP error when the payload is not JSON */ }
  }
  return error;
}

export async function triggerBackupDownload(apiClient, backup, {
  documentRef = document,
  urlApi = URL,
  schedule = setTimeout
} = {}) {
  let response;
  try {
    response = await apiClient.get(`/operations/backups/${backup.id}/download`, { responseType: 'blob' });
  } catch (error) {
    throw await normalizeBlobError(error);
  }
  const disposition = response.headers?.['content-disposition'] || response.headers?.get?.('content-disposition');
  const filename = attachmentFilename(disposition, backup.filename);
  const objectUrl = urlApi.createObjectURL(response.data);
  const anchor = documentRef.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  documentRef.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    schedule(() => urlApi.revokeObjectURL(objectUrl), 0);
  }
  return filename;
}
