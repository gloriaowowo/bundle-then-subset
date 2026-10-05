import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ModelUsage } from "./types.js";

export interface CachedModelResponse {
  schemaVersion: 1;
  requestHash: string;
  rawText: string;
  usage: ModelUsage;
}

export class FileModelCache {
  constructor(private readonly cacheDirectory: string) {}

  async get(requestHash: string): Promise<CachedModelResponse | undefined> {
    const cachePath = this.pathFor(requestHash);
    try {
      const value = JSON.parse(await readFile(cachePath, "utf8")) as CachedModelResponse;
      if (value.schemaVersion !== 1 || value.requestHash !== requestHash || typeof value.rawText !== "string") {
        throw new Error(`Invalid model cache entry ${cachePath}.`);
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async put(value: CachedModelResponse): Promise<string> {
    await mkdir(this.cacheDirectory, { recursive: true });
    const cachePath = this.pathFor(value.requestHash);
    await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return cachePath;
  }

  private pathFor(requestHash: string): string {
    if (!/^[a-f0-9]{64}$/.test(requestHash)) {
      throw new Error("Model request hash must be a SHA-256 hex digest.");
    }
    return path.join(this.cacheDirectory, `${requestHash}.json`);
  }
}
