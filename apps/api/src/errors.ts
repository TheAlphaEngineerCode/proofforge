import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, details);
export const unauthorized = (message = "authentication required"): HttpError =>
  new HttpError(401, message);
export const forbidden = (message = "forbidden"): HttpError => new HttpError(403, message);
export const notFound = (message = "not found"): HttpError => new HttpError(404, message);

/**
 * Parse a request payload against a Zod schema, throwing a 400 on failure.
 * Returns the schema's *output* type, so applied `.default()`s are non-optional.
 */
export function parse<S extends z.ZodTypeAny>(schema: S, payload: unknown): z.output<S> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw badRequest("invalid request body", result.error.issues);
  }
  return result.data;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      void reply.status(error.statusCode).send({
        error: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
      return;
    }
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: "validation failed", details: error.issues });
      return;
    }
    app.log.error(error);
    void reply.status(500).send({ error: "internal server error" });
  });
}
