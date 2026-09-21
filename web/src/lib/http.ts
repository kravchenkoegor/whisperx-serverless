import { S3ServiceException } from "@aws-sdk/client-s3";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MissingEnvError } from "./env";
import { ObjectTooLargeError } from "./r2";
import { RunpodError } from "./runpod";
import { SESSION_COOKIE, isValidSessionToken } from "./session";

export type RouteParams<P> = { params: Promise<P> };
type Handler<C> = (request: NextRequest, context: C) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(status: number, error: string, details?: unknown): NextResponse {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) return jsonError(error.status, error.message);
  if (error instanceof z.ZodError) return jsonError(400, z.prettifyError(error), z.flattenError(error));
  if (error instanceof MissingEnvError) return jsonError(500, `Server is not configured: ${error.message}`);
  if (error instanceof ObjectTooLargeError) return jsonError(413, "File is too large to display");
  if (error instanceof RunpodError) {
    return jsonError(error.status === 404 ? 404 : 502, error.message);
  }
  if (error instanceof S3ServiceException) {
    return jsonError(502, `Storage error: ${error.name}: ${error.message}`);
  }
  console.error(error);
  return jsonError(500, error instanceof Error ? error.message : "Unexpected error");
}

export function publicRoute<C>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

// Defence in depth: handlers re-check the session so a proxy matcher mistake cannot expose them.
export function protectedRoute<C>(handler: Handler<C>): Handler<C> {
  return publicRoute(async (request, context) => {
    const authenticated = await isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (!authenticated) return jsonError(401, "Authentication required");
    return handler(request, context);
  });
}

export async function readJson<S extends z.ZodType>(request: NextRequest, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  return schema.parse(body);
}
