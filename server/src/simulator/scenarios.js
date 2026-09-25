import { DEMO_FOLDERS, listSeedFiles, readSeedFile } from './demoData.js';
import { SimulatorHttpError } from './apiClient.js';
import { encode } from './transform.js';

// Simulator scenarios (spec §30). Each one drives the demo account through the HTTP API
// client only. `progress({ step, total, lastAction, stoppedReason? })` reports each write.
//
//   seed             demo-data/ → folders documents, finance, projects via POST /api/files
//   ransomware-like  enumerate, then per file: download → transformed content → rename
//                    "<name>.locked", folders interleaved, one hidden (canary) file touched
//                    halfway; stops at the first 423 (the freeze)
//   normal-use       a few uploads and edits at human pace; stays SAFE

export const FROZEN_REASON = 'frozen by ShieldShare';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// ── seed ────────────────────────────────────────────────────────────────────────────────

export async function seed({ api, progress }) {
  const seeds = await listSeedFiles();
  const folders = await api.folders();
  const byName = new Map(folders.map((folder) => [folder.name, folder]));
  for (const name of DEMO_FOLDERS) {
    if (!byName.has(name)) byName.set(name, await api.createFolder(name));
  }

  // Idempotent: a seed file already present (same name, same folder) is skipped.
  const present = new Set((await api.listFiles()).map((file) => `${file.folderId}/${file.name}`));
  let uploaded = 0;
  let skipped = 0;
  for (const [index, entry] of seeds.entries()) {
    const folder = byName.get(entry.folder);
    const label = `${entry.folder}/${entry.name}`;
    if (present.has(`${folder.id}/${entry.name}`)) {
      skipped += 1;
      progress({ step: index + 1, total: seeds.length, lastAction: `SKIP ${label} (already in the workspace)` });
      continue;
    }
    const content = await readSeedFile(entry.relativePath);
    await api.upload({ name: entry.name, content, mimeType: entry.mimeType, folderId: folder.id });
    uploaded += 1;
    progress({ step: index + 1, total: seeds.length, lastAction: `UPLOAD ${label}` });
  }
  return { uploaded, skipped, total: seeds.length };
}

// ── ransomware-like ─────────────────────────────────────────────────────────────────────

// Round-robin over folders so the burst spreads across directories the way mass encryption
// does, instead of finishing one folder at a time.
function interleave(files, folderOrder) {
  const groups = folderOrder.map((folderId) => files.filter((file) => file.folderId === folderId)).filter((group) => group.length);
  const order = [];
  for (let round = 0; groups.some((group) => round < group.length); round += 1) {
    for (const group of groups) if (round < group.length) order.push(group[round]);
  }
  return order;
}

/**
 * @returns {{ step, total, stoppedReason, firstWriteAt, targets }}
 */
export async function ransomwareLike({ api, paceMs, progress }) {
  const folders = await api.folders();
  const folderName = new Map(folders.map((folder) => [folder.id, folder.name]));
  // Enumeration returns every file, including ones the web client never lists; comparing it
  // with the normal listing tells the simulator which files are hidden (the canaries).
  const everything = (await api.listFiles({ all: true })).filter((file) => file.status === 'ACTIVE');
  const listed = new Set((await api.listFiles()).map((file) => file.id));
  const visible = everything.filter((file) => listed.has(file.id) && !file.name.endsWith('.locked'));
  const hidden = everything.filter((file) => !listed.has(file.id));

  const folderOrder = [...folders].sort((a, b) => Number(a.isRoot) - Number(b.isRoot) || a.name.localeCompare(b.name)).map((folder) => folder.id);
  const order = interleave(visible, folderOrder).map((file) => ({ file, hidden: false }));
  if (hidden.length && order.length) order.splice(Math.floor(order.length / 2), 0, { file: hidden[0], hidden: true });

  const total = order.length * 2;
  let step = 0;
  let firstWriteAt = null;
  const report = (lastAction, stoppedReason) => progress({ step, total, lastAction, ...(stoppedReason ? { stoppedReason } : {}) });
  const result = (stoppedReason = null) => ({ step, total, stoppedReason, firstWriteAt, targets: order.length });

  if (total === 0) {
    report('Nothing to do: the demo workspace has no files. Seed it first.', 'no files to process');
    return result('no files to process');
  }

  for (const { file, hidden: isHidden } of order) {
    const label = `${folderName.get(file.folderId) ?? 'folder'}/${file.name}${isHidden ? ' (hidden file)' : ''}`;
    const lockedName = `${file.name}.locked`;
    let action = `DOWNLOAD ${label}`;
    try {
      const original = await api.download(file.id);
      const transformed = encode(original);

      action = `MODIFY ${label}`;
      firstWriteAt ??= new Date();
      await api.replaceContent(file.id, file.name, transformed);
      step += 1;
      report(action);
      await sleep(paceMs);

      action = `RENAME ${label} → ${lockedName}`;
      await api.rename(file.id, lockedName);
      step += 1;
      report(action);
      await sleep(paceMs);
    } catch (error) {
      if (error instanceof SimulatorHttpError && error.status === 423) {
        report(`423 Locked on ${action}`, FROZEN_REASON);
        return result(FROZEN_REASON);
      }
      const reason = error instanceof SimulatorHttpError
        ? `error: ${error.status} ${error.code} on ${action}`
        : `error: ${error.message}`;
      report(`Stopped on ${action}`, reason);
      return result(reason);
    }
  }
  return result();
}

// ── normal-use ──────────────────────────────────────────────────────────────────────────

function stamp(date = new Date()) {
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}

const WEEKLY_UPDATE = (date) => [
  `# Weekly update, ${date.toISOString().slice(0, 10)}`,
  '',
  '## Done',
  '- Reviewed the onboarding checklist with the two new starters.',
  '- Closed the open questions on the Q3 budget spreadsheet.',
  '',
  '## Next',
  '- Draft the agenda for the planning session.',
  '',
].join('\n');

const EXPENSES = (date) => [
  'date,category,description,amount_eur',
  `${date.toISOString().slice(0, 10)},travel,Train tickets for the client workshop,86.40`,
  `${date.toISOString().slice(0, 10)},supplies,Notebooks and whiteboard markers,23.15`,
  `${date.toISOString().slice(0, 10)},meals,Team lunch after the release,142.00`,
  '',
].join('\n');

export async function normalUse({ api, paceMs, progress }) {
  const now = new Date();
  const folders = await api.folders();
  const home = folders.find((folder) => folder.isRoot);
  const documents = folders.find((folder) => folder.name === 'documents') ?? home;
  const finance = folders.find((folder) => folder.name === 'finance') ?? home;
  const existingDoc = (await api.listFiles())
    .find((file) => file.folderId === documents.id && /\.(md|txt)$/i.test(file.name) && file.status === 'ACTIVE');

  const noteName = `weekly-update-${stamp(now)}.md`;
  const plan = [
    { label: `UPLOAD documents/${noteName}`, run: async (state) => {
      state.note = (await api.upload({ name: noteName, content: WEEKLY_UPDATE(now), mimeType: 'text/markdown', folderId: documents.id })).file;
    } },
    { label: `MODIFY documents/${noteName}`, run: async (state) => {
      await api.replaceContent(state.note.id, noteName, `${WEEKLY_UPDATE(now)}- Book a room for Thursday.\n`, 'text/markdown');
    } },
    ...(existingDoc ? [{ label: `MODIFY documents/${existingDoc.name}`, run: async () => {
      const current = await api.download(existingDoc.id);
      await api.replaceContent(existingDoc.id, existingDoc.name, Buffer.concat([current, Buffer.from('\nReviewed during the weekly update.\n')]), 'text/plain');
    } }] : []),
    { label: `UPLOAD finance/expenses-${stamp(now)}.csv`, run: async () => {
      await api.upload({ name: `expenses-${stamp(now)}.csv`, content: EXPENSES(now), mimeType: 'text/csv', folderId: finance.id });
    } },
  ];

  const state = {};
  let step = 0;
  for (const [index, entry] of plan.entries()) {
    try {
      await entry.run(state);
    } catch (error) {
      const reason = error instanceof SimulatorHttpError && error.status === 423
        ? FROZEN_REASON
        : `error: ${error.status ?? ''} ${error.code ?? error.message} on ${entry.label}`.replace(/\s+/g, ' ');
      progress({ step, total: plan.length, lastAction: `Stopped on ${entry.label}`, stoppedReason: reason });
      return { step, total: plan.length, stoppedReason: reason, firstWriteAt: null };
    }
    step += 1;
    progress({ step, total: plan.length, lastAction: entry.label });
    if (index < plan.length - 1) await sleep(paceMs);
  }
  return { step, total: plan.length, stoppedReason: null, firstWriteAt: null };
}
