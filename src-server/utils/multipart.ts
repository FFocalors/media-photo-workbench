import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs-extra";
import { Request } from "express";

export interface MultipartFile {
  fieldName: string;
  originalFilename: string;
  path: string;
  size: number;
  mimeType: string;
}

export interface MultipartFormData {
  fields: Record<string, string>;
  files: MultipartFile[];
  cleanup: () => Promise<void>;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

function getBoundary(contentType: string | undefined): string {
  const match = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary) {
    throw { code: "INVALID_MULTIPART_REQUEST", message: "缺少 multipart boundary" };
  }
  return boundary;
}

function parseContentDisposition(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;

  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || rawValue.length === 0) continue;
    const key = rawKey.toLowerCase();
    const joined = rawValue.join("=");
    result[key] = joined.replace(/^"|"$/g, "");
  }

  return result;
}

function parseHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of value.split("\r\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function sanitizeFilename(value: string): string {
  return (value || "upload")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

async function readRequestBody(req: Request, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw { code: "UPLOAD_TOO_LARGE", message: "上传内容过大" };
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export async function parseMultipartForm(
  req: Request,
  options: { maxBytes?: number; maxFiles?: number } = {}
): Promise<MultipartFormData> {
  const boundary = getBoundary(req.headers["content-type"]);
  const body = await readRequestBody(req, options.maxBytes ?? 512 * 1024 * 1024);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-photo-workbench-upload-"));
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  let cursor = body.indexOf(boundaryBuffer);
  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;
    if (body.slice(partStart, partStart + 2).toString() === "--") {
      break;
    }
    if (body.slice(partStart, partStart + 2).equals(CRLF)) {
      partStart += 2;
    }

    const headerEnd = body.indexOf(HEADER_END, partStart);
    if (headerEnd === -1) break;

    const headers = parseHeaders(body.slice(partStart, headerEnd).toString("utf8"));
    const disposition = parseContentDisposition(headers["content-disposition"]);
    const name = disposition.name ?? "";
    const filename = disposition.filename ?? "";
    const contentStart = headerEnd + HEADER_END.length;
    const nextBoundary = body.indexOf(boundaryBuffer, contentStart);
    if (nextBoundary === -1) break;

    let contentEnd = nextBoundary;
    if (body.slice(contentEnd - 2, contentEnd).equals(CRLF)) {
      contentEnd -= 2;
    }

    const content = body.slice(contentStart, contentEnd);
    if (filename) {
      if (options.maxFiles && files.length >= options.maxFiles) {
        throw { code: "TOO_MANY_FILES", message: `一次最多上传 ${options.maxFiles} 个文件` };
      }
      const safeName = `${crypto.randomUUID()}_${sanitizeFilename(path.basename(filename))}`;
      const filePath = path.join(tempDir, safeName);
      await fs.writeFile(filePath, content);
      files.push({
        fieldName: name,
        originalFilename: path.basename(filename),
        path: filePath,
        size: content.length,
        mimeType: headers["content-type"] ?? ""
      });
    } else if (name) {
      fields[name] = content.toString("utf8");
    }

    cursor = nextBoundary;
  }

  return {
    fields,
    files,
    cleanup: async () => {
      await fs.remove(tempDir);
    }
  };
}
