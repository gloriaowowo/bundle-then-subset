import type { JsonValue } from "../domain/types.js";
export interface RunManifest {
    schemaVersion: 1;
    runId: string;
    createdAt: string;
    benchmarkId: string;
    method: string;
    model: {
        provider: string;
        id: string;
        temperature: number;
    };
    hashes: Record<string, string>;
    metrics: Record<string, number>;
    modelCalls: number;
    modelRequestMade: boolean;
    notes: string[];
}
export declare function hashArtifact(value: JsonValue | object): string;
export declare function writeRunManifest(workspaceRoot: string, manifest: RunManifest): Promise<string>;
