/**
 * One-time cleanup: move photos that older builds embedded in Firestore documents as base64
 * `data:image/...` strings out to Cloud Storage, and replace each with its short download URL.
 *
 * Why: Firestore bills reads by document size (one read unit per 4 KB). About 200 old tasks
 * still carry the same lab-drop photo three times (~600 KB per task), and two rider documents
 * carry a profile photo. Every live listener that loads or updates those documents pays for all
 * of it again, which is what pushed reads past the free daily quota. Current builds already
 * upload photos to Storage, so this only fixes old data.
 *
 * Safe by design:
 *   - Dry run by default. Nothing is written unless you pass --apply.
 *   - Each document is updated only if it has not changed since it was read
 *     (lastUpdateTime precondition), so it cannot overwrite a live edit.
 *   - Only the top-level fields that contained a photo are written; nothing else is touched.
 *   - Identical photos inside one document are uploaded once and share one URL.
 *   - Each upload is downloaded back and checked byte-for-byte before the document changes.
 *   - The original field values are saved to a local file before each document changes.
 *   - Nothing is ever deleted, in Firestore or Storage.
 *
 * Usage (uses your gcloud Application Default Credentials):
 *   node scripts/move-inline-photos-to-storage.mjs                                         # dry run
 *   node scripts/move-inline-photos-to-storage.mjs --apply --save-originals=<file.jsonl>   # write
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import crypto from 'crypto';
import fs from 'fs';

const PROJECT_ID = 'gen-lang-client-0401908863';
const DB_ID = 'ai-studio-secondmedicvialt-672ab7fa-5c2a-4a7b-9439-899ee4ab7829';
const BUCKET = 'gen-lang-client-0401908863.firebasestorage.app';
const COLLECTIONS = ['tasks', 'trips', 'riders', 'routes', 'clients', 'attendance'];
const APPLY = process.argv.includes('--apply');
// Every original field value is appended here (one JSON line per document) before that document
// is changed, so the embedded copies are kept on disk as well. Required with --apply.
const ORIGINALS = (process.argv.find((a) => a.startsWith('--save-originals=')) || '').split('=').slice(1).join('=');
if (APPLY && !ORIGINALS) {
  console.error('--apply needs --save-originals=<file.jsonl> (keep it outside the repo: it holds patient-sample photos).');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore(app, DB_ID);
const bucket = getStorage(app).bucket();

const isInlinePhoto = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length > 1000;

function containsInlinePhoto(v) {
  if (isInlinePhoto(v)) return true;
  if (Array.isArray(v)) return v.some(containsInlinePhoto);
  if (v && typeof v === 'object' && v.constructor === Object) return Object.values(v).some(containsInlinePhoto);
  return false;
}

/** Returns a copy of `v` with every inline photo replaced by the URL `resolve` gives for it. */
async function replacePhotos(v, resolve) {
  if (isInlinePhoto(v)) return resolve(v);
  if (Array.isArray(v)) return Promise.all(v.map((x) => replacePhotos(x, resolve)));
  if (v && typeof v === 'object' && v.constructor === Object) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await replacePhotos(x, resolve);
    return out;
  }
  return v;
}

async function uploadDataUrl(dataUrl, path) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match || !match[2]) throw new Error(`Unsupported data URL at ${path}`);
  const contentType = match[1];
  const token = crypto.randomUUID();
  const bytes = Buffer.from(match[3], 'base64');
  const file = bucket.file(path);
  await file.save(bytes, {
    resumable: false,
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
  });
  // Read the stored file back and compare before the document is allowed to point at it.
  const [stored] = await file.download();
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  if (sha(stored) !== sha(bytes)) throw new Error(`Uploaded copy of ${path} does not match the original`);
  // Same URL shape the client SDK's getDownloadURL() returns, so the app treats it identically.
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

let totalDocs = 0;
let totalPhotos = 0;
let bytesBefore = 0;
let bytesAfter = 0;
const failures = [];

for (const collectionName of COLLECTIONS) {
  const snap = await db.collection(collectionName).get();
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const fields = Object.keys(data).filter((k) => containsInlinePhoto(data[k]));
    if (fields.length === 0) continue;

    totalDocs += 1;
    const before = JSON.stringify(data).length;
    const uploads = new Map(); // photo content hash -> URL (dedupe within this document)
    const folder = collectionName === 'riders' ? `riders/${docSnap.id}` : `proofs/${docSnap.id}`;

    const resolve = async (dataUrl) => {
      const hash = crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 16);
      if (!uploads.has(hash)) {
        const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
        const path = `${folder}/migrated-${hash}.${ext}`;
        uploads.set(hash, APPLY ? uploadDataUrl(dataUrl, path) : Promise.resolve(`https://firebasestorage.example/${path}`));
      }
      return uploads.get(hash);
    };

    try {
      const update = {};
      for (const field of fields) update[field] = await replacePhotos(data[field], resolve);
      const after = JSON.stringify({ ...data, ...update }).length;
      totalPhotos += uploads.size;
      bytesBefore += before;
      bytesAfter += after;
      console.log(
        `${APPLY ? 'UPDATE' : 'would update'} ${collectionName}/${docSnap.id}: ` +
        `${uploads.size} photo(s), fields [${fields.join(', ')}], ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(1)} KB`
      );
      if (APPLY) {
        const original = Object.fromEntries(fields.map((f) => [f, data[f]]));
        fs.appendFileSync(ORIGINALS, JSON.stringify({ path: docSnap.ref.path, updateTime: docSnap.updateTime.toDate().toISOString(), original }) + '\n');
        await docSnap.ref.update(update, { lastUpdateTime: docSnap.updateTime });
      }
    } catch (err) {
      failures.push(`${collectionName}/${docSnap.id}: ${err.message}`);
      console.error(`FAILED ${collectionName}/${docSnap.id}: ${err.message}`);
    }
  }
}

console.log('\n----- Summary -----');
console.log(`Mode: ${APPLY ? 'APPLIED' : 'DRY RUN (nothing written; pass --apply to write)'}`);
console.log(`Documents with inline photos: ${totalDocs}`);
console.log(`Distinct photos ${APPLY ? 'uploaded' : 'to upload'}: ${totalPhotos}`);
console.log(`Size of those documents: ${(bytesBefore / 1048576).toFixed(1)} MB -> ${(bytesAfter / 1048576).toFixed(2)} MB`);
if (failures.length) {
  console.log(`Failures (${failures.length}) - safe to re-run; documents that changed meanwhile are skipped:`);
  failures.forEach((f) => console.log(`  ${f}`));
  process.exitCode = 1;
}
