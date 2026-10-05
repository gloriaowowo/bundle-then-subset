import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export class FileModelCache {
    cacheDirectory;
    constructor(cacheDirectory) {
        this.cacheDirectory = cacheDirectory;
    }
    async get(requestHash) {
        const cachePath = this.pathFor(requestHash);
        try {
            const value = JSON.parse(await readFile(cachePath, "utf8"));
            if (value.schemaVersion !== 1 || value.requestHash !== requestHash || typeof value.rawText !== "string") {
                throw new Error(`Invalid model cache entry ${cachePath}.`);
            }
            return value;
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }
    async put(value) {
        await mkdir(this.cacheDirectory, { recursive: true });
        const cachePath = this.pathFor(value.requestHash);
        await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        return cachePath;
    }
    pathFor(requestHash) {
        if (!/^[a-f0-9]{64}$/.test(requestHash)) {
            throw new Error("Model request hash must be a SHA-256 hex digest.");
        }
        return path.join(this.cacheDirectory, `${requestHash}.json`);
    }
}
//# sourceMappingURL=cache.js.map