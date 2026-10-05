import type { GradeResult } from "../domain/types.js";
export interface AcquisitionPoint {
    evidenceFraction: number;
    verifiedAutomationCoverage: number;
}
export declare function verifiedAutomationCoverage(grades: GradeResult[]): number;
/**
 * Coverage of an artifact that is eligible for enterprise deployment under the
 * frozen promotion contract. One observed policy or grounding failure rejects
 * the artifact as a whole; a rejected artifact contributes zero deployed
 * coverage even if some individual cases happened to pass.
 */
export declare function safetyConstrainedVac(grades: GradeResult[]): number;
export declare function normalizedAcquisitionAuc(points: AcquisitionPoint[]): number;
