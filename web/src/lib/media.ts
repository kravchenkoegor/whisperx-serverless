const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

export function mediaContentType(file: { name: string; type: string }): string | null {
  const declared = file.type.split(";")[0].trim().toLowerCase();
  if (/^(audio|video)\//.test(declared)) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}
