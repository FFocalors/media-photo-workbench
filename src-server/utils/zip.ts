import fs from "fs-extra";
import path from "path";
import { pipeline } from "stream/promises";

export interface ZipFileEntry {
  name: string;
  path?: string;
  content?: Buffer | string;
}

interface PreparedZipEntry {
  name: string;
  nameBuffer: Buffer;
  path?: string;
  content?: Buffer;
  crc32: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[i] = value >>> 0;
}

function updateCrc32(crc: number, buffer: Buffer): number {
  let value = crc ^ 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function crc32File(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let crc = 0;
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      crc = updateCrc32(crc, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(crc >>> 0));
  });
}

function getDosDateTime(date = new Date()): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "");
}

function writeUInt32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function localHeader(entry: PreparedZipEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.nameBuffer]);
}

function centralHeader(entry: PreparedZipEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.nameBuffer]);
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralSize, 12);
  header.writeUInt32LE(centralOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

async function prepareEntry(entry: ZipFileEntry): Promise<PreparedZipEntry> {
  const name = normalizeEntryName(entry.name);
  const nameBuffer = Buffer.from(name, "utf8");
  const { dosDate, dosTime } = getDosDateTime();

  if (entry.path) {
    const stat = await fs.stat(entry.path);
    if (!stat.isFile()) {
      throw new Error(`ZIP 条目不是文件：${entry.path}`);
    }
    if (stat.size > 0xffffffff) {
      throw new Error(`ZIP 条目超过 4GB，当前版本不支持：${entry.path}`);
    }
    return {
      name,
      nameBuffer,
      path: entry.path,
      crc32: await crc32File(entry.path),
      size: stat.size,
      offset: 0,
      dosDate,
      dosTime
    };
  }

  const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? "", "utf8");
  return {
    name,
    nameBuffer,
    content,
    crc32: updateCrc32(0, content),
    size: content.length,
    offset: 0,
    dosDate,
    dosTime
  };
}

export async function createZipArchive(entries: ZipFileEntry[], outputPath: string): Promise<void> {
  await fs.ensureDir(path.dirname(outputPath));
  const prepared = await Promise.all(entries.map(prepareEntry));
  const output = fs.createWriteStream(outputPath);
  let offset = 0;

  for (const entry of prepared) {
    entry.offset = offset;
    const header = localHeader(entry);
    output.write(header);
    offset += header.length;

    if (entry.path) {
      await pipeline(fs.createReadStream(entry.path), output, { end: false });
    } else if (entry.content) {
      output.write(entry.content);
    }
    offset += entry.size;
  }

  const centralOffset = offset;
  const centralBuffers = prepared.map(centralHeader);
  for (const buffer of centralBuffers) {
    output.write(buffer);
    offset += buffer.length;
  }

  const centralSize = offset - centralOffset;
  output.write(endOfCentralDirectory(prepared.length, centralSize, centralOffset));
  output.end();

  await new Promise<void>((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
  });
}
