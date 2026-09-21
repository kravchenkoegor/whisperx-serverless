export const LANGUAGES = ["ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const RECORDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const PROMPT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const AUDIO_EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;
const KEY_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const RECORDING_FILE_KEY_PATTERN = new RegExp(
  `^recordings/([A-Za-z0-9][A-Za-z0-9_-]{0,63})/${KEY_SEGMENT}(/${KEY_SEGMENT})?$`,
);
const PROMPT_KEY_PATTERN = /^prompts\/[a-z0-9][a-z0-9_-]{0,63}\.txt$/;
const MAX_KEY_LENGTH = 512;
const SLUG_MAX_LENGTH = 40;

export const RECORDINGS_PREFIX = "recordings/";
export const PROMPTS_PREFIX = "prompts/";

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
};

export function isRecordingId(value: unknown): value is string {
  return typeof value === "string" && RECORDING_ID_PATTERN.test(value);
}

export function isPromptName(value: unknown): value is string {
  return typeof value === "string" && PROMPT_NAME_PATTERN.test(value);
}

export function isJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

export function slugify(title: string, maxLength = SLUG_MAX_LENGTH): string {
  const latin = Array.from(title.toLowerCase(), (char) => CYRILLIC_TO_LATIN[char] ?? char).join("");
  return latin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

export function recordingTimestamp(now: Date): string {
  const iso = now.toISOString();
  const date = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
  const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
  return `${date}-${time}`;
}

export function generateRecordingId(title: string, now: Date = new Date()): string {
  const slug = slugify(title);
  const stamp = recordingTimestamp(now);
  return slug ? `${stamp}-${slug}` : stamp;
}

export function timestampFromRecordingId(id: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!match) return null;
  const [, yy, mo, dd, hh, mi, ss] = match;
  const date = new Date(`20${yy}-${mo}-${dd}T${hh}:${mi}:${ss}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function audioExtension(filename: string, contentType: string): string {
  const fromName = filename.split(".").pop()?.toLowerCase() ?? "";
  if (filename.includes(".") && AUDIO_EXTENSION_PATTERN.test(fromName)) return fromName;
  return CONTENT_TYPE_EXTENSIONS[contentType.toLowerCase()] ?? "bin";
}

export function recordingPrefix(id: string): string {
  return `${RECORDINGS_PREFIX}${id}/`;
}

export function metaKey(id: string): string {
  return `${recordingPrefix(id)}meta.json`;
}

export function audioKey(id: string, extension: string): string {
  return `${recordingPrefix(id)}audio.${extension}`;
}

export function passJsonKey(id: string, language: Language): string {
  return `${recordingPrefix(id)}${id}.${language}.json`;
}

export function diarizationKey(id: string, language: Language): string {
  return `${recordingPrefix(id)}${id}.${language}.diarization.json`;
}

export function jobDocumentKey(id: string, jobId: string): string {
  return `${recordingPrefix(id)}jobs/${jobId}.json`;
}

export function pendingKey(id: string, jobId: string): string {
  return `${recordingPrefix(id)}pending/${jobId}.json`;
}

export function promptKey(name: string): string {
  return `${PROMPTS_PREFIX}${name}.txt`;
}

export function isAudioKeyFor(id: string, key: string): boolean {
  const prefix = `${recordingPrefix(id)}audio.`;
  return key.startsWith(prefix) && AUDIO_EXTENSION_PATTERN.test(key.slice(prefix.length));
}

export function isServableKey(key: string): boolean {
  if (key.length > MAX_KEY_LENGTH) return false;
  return RECORDING_FILE_KEY_PATTERN.test(key) || PROMPT_KEY_PATTERN.test(key);
}

export function fileNameOfKey(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}
