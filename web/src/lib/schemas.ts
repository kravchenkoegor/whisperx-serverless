import { z } from "zod";
import { JOB_ID_PATTERN, LANGUAGES, RECORDING_ID_PATTERN } from "./ids";
import {
  MAX_BATCH_SIZE,
  MAX_PROMPT_CHARS,
  MAX_SPEAKERS,
  MAX_UPLOAD_BYTES,
  MIN_BATCH_SIZE,
  MIN_SPEAKERS,
} from "./limits";

const languageSchema = z.enum(LANGUAGES);
const promptSchema = z.string().max(MAX_PROMPT_CHARS).nullable();
const speakerCountSchema = z.number().int().min(MIN_SPEAKERS).max(MAX_SPEAKERS).nullable();

const thresholdsSchema = z.strictObject({
  merge_gap: z.number().optional(),
  max_unit: z.number().optional(),
  min_lid_sec: z.number().optional(),
  lid_confident: z.number().optional(),
  cyrillic_min: z.number().optional(),
  latin_min: z.number().optional(),
  en_max_cyrillic: z.number().optional(),
  speaker_one_sided: z.number().optional(),
  echo_ngram: z.number().int().optional(),
  prompt_echo_thresh: z.number().optional(),
});

const mergeSchema = z.strictObject({
  prompt: promptSchema.default(null),
  thresholds: thresholdsSchema.default({}),
});

const passSchema = z.strictObject({
  language: languageSchema,
  prompt: promptSchema.default(null),
  align: z.boolean().default(true),
});

const sharedJobFields = {
  recording_id: z.string().regex(RECORDING_ID_PATTERN),
  audio_key: z.string().min(1).max(512),
  diarize: z.boolean().default(true),
  min_speakers: speakerCountSchema.default(null),
  max_speakers: speakerCountSchema.default(null),
  reuse_diarization: z.boolean().default(true),
  batch_size: z.number().int().min(MIN_BATCH_SIZE).max(MAX_BATCH_SIZE).nullable().default(null),
};

const transcribeJobSchema = z.strictObject({
  task: z.literal("transcribe"),
  ...sharedJobFields,
  passes: z
    .array(passSchema)
    .min(1, "at least one pass is required")
    .refine(
      (passes) => new Set(passes.map((pass) => pass.language)).size === passes.length,
      "each language may appear in passes only once",
    ),
  merge: mergeSchema.nullable().default(null),
});

const mergeJobSchema = z.strictObject({
  task: z.literal("merge_ru_en"),
  ...sharedJobFields,
  merge: mergeSchema,
});

export const jobInputSchema = z
  .discriminatedUnion("task", [transcribeJobSchema, mergeJobSchema])
  .refine(
    (job) => job.min_speakers === null || job.max_speakers === null || job.min_speakers <= job.max_speakers,
    { message: "min_speakers must not exceed max_speakers", path: ["min_speakers"] },
  );

export type JobInput = z.infer<typeof jobInputSchema>;
export type JobInputDraft = z.input<typeof jobInputSchema>;
export type MergeInput = z.infer<typeof mergeSchema>;

export const createRecordingSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .max(100)
    .regex(/^(audio|video)\/[a-z0-9][a-z0-9.+-]*$/, "only audio and video files are accepted"),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "file is larger than 2 GB"),
});

export const recordingMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  original_filename: z.string(),
  content_type: z.string(),
  size: z.number(),
  created_at: z.string(),
});

export type RecordingMeta = z.infer<typeof recordingMetaSchema>;

export const pendingMarkerSchema = z.object({
  job_id: z.string().regex(JOB_ID_PATTERN),
  task: z.enum(["transcribe", "merge_ru_en"]),
  submitted_at: z.string(),
  languages: z.array(languageSchema),
  merge: z.boolean(),
});

export type PendingMarker = z.infer<typeof pendingMarkerSchema>;

const timingsSchema = z.record(z.string(), z.number());
const countsSchema = z.record(z.string(), z.number());

export const jobDocumentSchema = z.object({
  job_id: z.string(),
  status: z.enum(["completed", "failed"]),
  task: z.string().nullish(),
  recording_id: z.string().nullish(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  total_seconds: z.number().nullish(),
  gpu: z.object({ name: z.string().nullish(), vram_gb: z.number().nullish() }).nullish(),
  worker: z
    .object({
      boot_seconds: z.number().nullish(),
      jobs_served_before: z.number().nullish(),
      models_kept_loaded: z.boolean().nullish(),
      offline: z.boolean().nullish(),
    })
    .nullish(),
  passes: z
    .array(
      z.object({
        language: z.string(),
        aligned: z.boolean().nullish(),
        diarized: z.boolean().nullish(),
        batch_size: z.number().nullish(),
        timings: timingsSchema.nullish(),
      }),
    )
    .nullish(),
  merge: z
    .object({
      units: z.number().nullish(),
      turns: z.number().nullish(),
      langs: countsSchema.nullish(),
      rules: countsSchema.nullish(),
      sources: countsSchema.nullish(),
      speaker_en_shares: countsSchema.nullish(),
      lid_computed: z.number().nullish(),
      redecoded: z.number().nullish(),
    })
    .nullish(),
  timings: timingsSchema.nullish(),
  warnings: z.array(z.string()).nullish(),
  files: z.array(z.string()).nullish(),
  error: z.string().nullish(),
});

export type JobDocument = z.infer<typeof jobDocumentSchema>;

export const runpodStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  output: z.unknown().optional(),
  delayTime: z.number().optional(),
  executionTime: z.number().optional(),
});

export type RunpodStatus = z.infer<typeof runpodStatusSchema>;

export const savePromptSchema = z.strictObject({
  text: z.string().trim().min(1, "prompt is empty").max(MAX_PROMPT_CHARS),
});

export const loginSchema = z.object({
  password: z.string().min(1).max(1024),
  next: z.string().max(2048).optional(),
});
