import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mapWithConcurrency } from "./async";
import { env } from "./env";

export const UPLOAD_URL_TTL_SECONDS = 600;
export const DOWNLOAD_URL_TTL_SECONDS = 300;
const DELETE_CONCURRENCY = 8;

export type StoredObject = {
  key: string;
  size: number;
  lastModified: string | null;
};

export class ObjectTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Object is larger than ${limitBytes} bytes`);
    this.name = "ObjectTooLargeError";
  }
}

let cachedClient: S3Client | null = null;

function client(): S3Client {
  cachedClient ??= new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId(),
      secretAccessKey: env.r2SecretAccessKey(),
    },
    // R2 rejects the CRC32 checksum parameters newer SDKs add to presigned PUT URLs by default.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return cachedClient;
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  return (
    error.name === "NoSuchKey" || error.name === "NotFound" || error.$metadata.httpStatusCode === 404
  );
}

export async function listObjects(prefix: string): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client().send(
      new ListObjectsV2Command({
        Bucket: env.r2Bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) continue;
      objects.push({
        key: item.Key,
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString() ?? null,
      });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: env.r2Bucket(), Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function getObjectText(key: string, maxBytes?: number): Promise<string | null> {
  try {
    const response = await client().send(new GetObjectCommand({ Bucket: env.r2Bucket(), Key: key }));
    if (maxBytes !== undefined && (response.ContentLength ?? 0) > maxBytes) {
      throw new ObjectTooLargeError(maxBytes);
    }
    return (await response.Body?.transformToString("utf-8")) ?? "";
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function getObjectJson(key: string): Promise<unknown> {
  const text = await getObjectText(key);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function putObjectText(key: string, body: string, contentType: string): Promise<void> {
  await client().send(
    new PutObjectCommand({ Bucket: env.r2Bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function putObjectJson(key: string, value: unknown): Promise<void> {
  await putObjectText(key, JSON.stringify(value, null, 2), "application/json");
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: env.r2Bucket(), Key: key }));
}

export async function deletePrefix(prefix: string): Promise<number> {
  const objects = await listObjects(prefix);
  await mapWithConcurrency(objects, DELETE_CONCURRENCY, (object) => deleteObject(object.key));
  return objects.length;
}

export async function presignUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: env.r2Bucket(), Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
  );
}

export async function presignDownload(key: string, attachmentName: string | null): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: env.r2Bucket(),
      Key: key,
      ResponseContentDisposition: attachmentName ? `attachment; filename="${attachmentName}"` : undefined,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  );
}
