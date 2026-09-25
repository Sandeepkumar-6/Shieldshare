import { useCallback, useRef, useState } from 'react';
import { fileApi } from '../../services/file.service.js';

// Sequential upload queue. Each item moves through states that map to real events:
//   queued → uploading (bytes sent, from XHR progress) → processing (all bytes sent, waiting
//   for the server to validate, hash and create the version) → done (server response) | error
let nextId = 0;

export function useUploadQueue({ onUploaded }) {
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pending = useRef([]);
  const running = useRef(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const update = useCallback((id, patch) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (pending.current.length > 0) {
      const job = pending.current.shift();
      update(job.id, { status: 'uploading', progress: 0, error: null });
      try {
        const result = await fileApi.upload(job.file, {
          folderId: job.folderId,
          onProgress: (fraction) => update(job.id, fraction >= 1
            ? { status: 'processing', progress: 1 }
            : { progress: fraction }),
        });
        update(job.id, { status: 'done', result });
        onUploadedRef.current?.(result);
      } catch (error) {
        update(job.id, { status: 'error', error });
      }
    }
    running.current = false;
  }, [update]);

  const enqueue = useCallback((files, folderId) => {
    const jobs = [...files].map((file) => {
      nextId += 1;
      return { id: `upload-${nextId}`, file, folderId };
    });
    setItems((list) => [
      ...jobs.map((job) => ({ id: job.id, file: job.file, folderId: job.folderId, status: 'queued', progress: 0 })),
      ...list,
    ]);
    pending.current.push(...jobs);
    run();
  }, [run]);

  // Side effects stay outside state updaters (StrictMode runs updaters twice).
  const retry = useCallback((id) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item) return;
    update(id, { status: 'queued', progress: 0, error: null });
    pending.current.push({ id, file: item.file, folderId: item.folderId });
    run();
  }, [run, update]);

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((list) => list.filter((item) => item.status !== 'done' && item.status !== 'error'));
  }, []);

  return { items, enqueue, retry, dismiss, clearFinished };
}
