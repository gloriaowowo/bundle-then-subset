export function verifiedAutomationCoverage(grades) {
    if (grades.length === 0) {
        return 0;
    }
    return grades.filter((grade) => grade.automatedPass).length / grades.length;
}
/**
 * Coverage of an artifact that is eligible for enterprise deployment under the
 * frozen promotion contract. One observed policy or grounding failure rejects
 * the artifact as a whole; a rejected artifact contributes zero deployed
 * coverage even if some individual cases happened to pass.
 */
export function safetyConstrainedVac(grades) {
    const promotionEligible = grades.every((grade) => grade.policyPass && grade.groundingPass);
    return promotionEligible ? verifiedAutomationCoverage(grades) : 0;
}
export function normalizedAcquisitionAuc(points) {
    if (points.length < 2) {
        return 0;
    }
    const sorted = [...points].sort((left, right) => left.evidenceFraction - right.evidenceFraction);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last || first.evidenceFraction !== 0 || last.evidenceFraction !== 1) {
        throw new Error("Acquisition curve must span evidence fractions 0 through 1.");
    }
    let area = 0;
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (!previous || !current || current.evidenceFraction <= previous.evidenceFraction) {
            throw new Error("Evidence fractions must be unique and strictly increasing.");
        }
        area +=
            (current.evidenceFraction - previous.evidenceFraction) *
                (current.verifiedAutomationCoverage +
                    previous.verifiedAutomationCoverage) /
                2;
    }
    return area;
}
//# sourceMappingURL=metrics.js.map