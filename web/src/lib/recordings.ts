import { mapWithConcurrency } from "./async";
import {
  LANGUAGES,
  type Language,
  RECORDINGS_PREFIX,
  audioExtension,
  audioKey,
  generateRecordingId,
  isAudioKeyFor,
  isJobId,
  isLanguage,
  isRecordingId,
  jobDocumentKey,
  metaKey,
  pendingKey,
  recordingPrefix,
  timestampFromRecordingId,
} from "./ids";
import {
  type StoredObject,
  deleteObject,
  deletePrefix,
  getObjectJson,
  listObjects,
  objectExists,
  presignUpload,
  putObjectJson,
} from "./r2";
import { cancelJob } from "./runpod";
import {
  type JobDocument,
  type PendingMarker,
  type RecordingMeta,
  jobDocumentSchema,
  pendingMarkerSchema,
  recordingMetaSchema,
} from "./schemas";
import type { FileKind, RecordingDetail, RecordingFile, RecordingSummary } from "./types";

const READ_CONCURRENCY = 16;
const JOB_DOCUMENT = /^jobs\/(.+)\.json$/;
const PENDING_MARKER = /^pending\/(.+)\.json$/;

function relativeName(id: string, key: string): string {
  return key.slice(recordingPrefix(id).length);
}

function groupByRecording(objects: StoredObject[]): Map<string, StoredObject[]> {
  const groups = new Map<string, StoredObject[]>();
  for (const object of objects) {
    const id = object.key.slice(RECORDINGS_PREFIX.length).split("/", 1)[0];
    if (!isRecordingId(id)) continue;
    const group = groups.get(id);
    if (group) group.push(object);
    else groups.set(id, [object]);
  }
  return groups;
}

function jobIdsMatching(names: string[], pattern: RegExp): string[] {
  return names.flatMap((name) => {
    const jobId = pattern.exec(name)?.[1];
    return isJobId(jobId) ? [jobId] : [];
  });
}

function unfinishedJobIds(names: string[]): string[] {
  const finished = new Set(jobIdsMatching(names, JOB_DOCUMENT));
  return jobIdsMatching(names, PENDING_MARKER).filter((jobId) => !finished.has(jobId));
}

function languagesPresent(id: string, names: Set<string>): Language[] {
  return LANGUAGES.filter((language) => names.has(`${id}.${language}.json`));
}

async function readMeta(id: string): Promise<RecordingMeta | null> {
  const parsed = recordingMetaSchema.safeParse(await getObjectJson(metaKey(id)));
  return parsed.success ? parsed.data : null;
}

function earliestModification(objects: StoredObject[]): string | null {
  const stamps = objects.flatMap((object) => (object.lastModified ? [object.lastModified] : []));
  return stamps.length > 0 ? stamps.reduce((a, b) => (a < b ? a : b)) : null;
}

async function summarize(id: string, objects: StoredObject[]): Promise<RecordingSummary> {
  const names = objects.map((object) => relativeName(id, object.key));
  const nameSet = new Set(names);
  const meta = nameSet.has("meta.json") ? await readMeta(id) : null;
  return {
    id,
    title: meta?.title ?? id,
    createdAt: meta?.created_at ?? timestampFromRecordingId(id) ?? earliestModification(objects),
    languages: languagesPresent(id, nameSet),
    merged: nameSet.has(`${id}.merged.txt`),
    hasAudio: objects.some((object) => isAudioKeyFor(id, object.key)),
    pendingJobs: unfinishedJobIds(names).length,
  };
}

function newestFirst(a: RecordingSummary, b: RecordingSummary): number {
  const byDate = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
}

export async function listRecordings(): Promise<RecordingSummary[]> {
  const groups = groupByRecording(await listObjects(RECORDINGS_PREFIX));
  const summaries = await mapWithConcurrency([...groups], READ_CONCURRENCY, ([id, objects]) =>
    summarize(id, objects),
  );
  return summaries.sort(newestFirst);
}

function classify(id: string, name: string): { kind: FileKind; language: Language | null } {
  if (name === "meta.json") return { kind: "meta", language: null };
  if (name.startsWith("audio.")) return { kind: "audio", language: null };
  if (name.startsWith("prompts/")) return { kind: "prompt", language: null };
  if (name === `${id}.merged.txt`) return { kind: "merged", language: null };
  if (name === `${id}.lid.json` || name === `${id}.redecode.json`) return { kind: "cache", language: null };
  if (!name.startsWith(`${id}.`)) return { kind: "other", language: null };

  const [language, ...rest] = name.slice(id.length + 1).split(".");
  if (!isLanguage(language)) return { kind: "other", language: null };
  const kinds: Record<string, FileKind> = {
    "speakers.txt": "speakers",
    txt: "text",
    srt: "srt",
    json: "json",
    "diarization.json": "diarization",
  };
  return { kind: kinds[rest.join(".")] ?? "other", language };
}

function toRecordingFile(id: string, object: StoredObject): RecordingFile {
  const name = relativeName(id, object.key);
  return { key: object.key, name, size: object.size, updatedAt: object.lastModified, ...classify(id, name) };
}

function fallbackDocument(jobId: string): JobDocument {
  return { job_id: jobId, status: "failed", error: "The status document could not be read." };
}

async function readJobDocument(id: string, jobId: string): Promise<JobDocument> {
  const raw = await getObjectJson(jobDocumentKey(id, jobId));
  const parsed = jobDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallbackDocument(jobId);
}

async function readPendingMarker(id: string, jobId: string): Promise<PendingMarker> {
  const raw = await getObjectJson(pendingKey(id, jobId));
  const parsed = pendingMarkerSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { job_id: jobId, task: "transcribe", submitted_at: "", languages: [], merge: false };
}

function newestJobFirst(a: JobDocument, b: JobDocument): number {
  return (b.finished_at ?? b.started_at ?? "").localeCompare(a.finished_at ?? a.started_at ?? "");
}

async function removeSupersededMarkers(id: string, names: string[]): Promise<void> {
  const finished = new Set(jobIdsMatching(names, JOB_DOCUMENT));
  const superseded = jobIdsMatching(names, PENDING_MARKER).filter((jobId) => finished.has(jobId));
  await Promise.allSettled(
    superseded.map((jobId) => deleteObject(pendingKey(id, jobId))),
  );
}

export async function getRecordingDetail(id: string): Promise<RecordingDetail | null> {
  const objects = await listObjects(recordingPrefix(id));
  if (objects.length === 0) return null;

  const names = objects.map((object) => relativeName(id, object.key));
  const nameSet = new Set(names);
  const [meta, jobs, pending] = await Promise.all([
    nameSet.has("meta.json") ? readMeta(id) : null,
    mapWithConcurrency(jobIdsMatching(names, JOB_DOCUMENT), READ_CONCURRENCY, (jobId) =>
      readJobDocument(id, jobId),
    ),
    mapWithConcurrency(unfinishedJobIds(names), READ_CONCURRENCY, (jobId) => readPendingMarker(id, jobId)),
    removeSupersededMarkers(id, names),
  ]);

  const files = objects
    .filter((object) => {
      const name = relativeName(id, object.key);
      return !JOB_DOCUMENT.test(name) && !PENDING_MARKER.test(name);
    })
    .map((object) => toRecordingFile(id, object))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id,
    meta,
    audioKey: objects.find((object) => isAudioKeyFor(id, object.key))?.key ?? null,
    languages: languagesPresent(id, nameSet),
    merged: nameSet.has(`${id}.merged.txt`),
    files,
    jobs: jobs.sort(newestJobFirst),
    pending: pending.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)),
  };
}

type NewRecording = { title: string; filename: string; contentType: string; size: number };
type CreatedRecording = { id: string; audioKey: string; uploadUrl: string };

async function allocateRecordingId(title: string, now: Date): Promise<string> {
  const id = generateRecordingId(title, now);
  if (!(await objectExists(metaKey(id)))) return id;
  return `${id}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function createRecording(input: NewRecording): Promise<CreatedRecording> {
  const now = new Date();
  const id = await allocateRecordingId(input.title, now);
  const key = audioKey(id, audioExtension(input.filename, input.contentType));
  const meta: RecordingMeta = {
    id,
    title: input.title,
    original_filename: input.filename,
    content_type: input.contentType,
    size: input.size,
    created_at: now.toISOString(),
  };
  await putObjectJson(metaKey(id), meta);
  return { id, audioKey: key, uploadUrl: await presignUpload(key, input.contentType) };
}

export async function deleteRecording(id: string): Promise<number> {
  const names = (await listObjects(recordingPrefix(id))).map((object) => relativeName(id, object.key));
  await Promise.allSettled(unfinishedJobIds(names).map((jobId) => cancelJob(jobId)));
  return deletePrefix(recordingPrefix(id));
}
