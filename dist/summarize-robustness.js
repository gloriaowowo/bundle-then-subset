import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashArtifact } from "./eval/manifest.js";
import { normalizedAcquisitionAuc } from "./eval/metrics.js";
const BOOTSTRAP_SEED = 20260822;
const BOOTSTRAP_REPLICATES = 10_000;
function mean(values) {
    if (values.length === 0)
        throw new Error("Cannot average an empty array.");
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
}
function percentile(sorted, probability) {
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
function organizationClusterInterval(values) {
    const grouped = new Map();
    for (const item of values) {
        const group = grouped.get(item.organizationId) ?? [];
        group.push(item.value);
        grouped.set(item.organizationId, group);
    }
    const clusterMeans = [...grouped.values()].map((items) => mean(items));
    if (clusterMeans.length === 0)
        throw new Error("Cannot bootstrap an empty sample.");
    const random = seededRandom(BOOTSTRAP_SEED);
    const estimates = Array.from({ length: BOOTSTRAP_REPLICATES }, () => {
        let total = 0;
        for (let index = 0; index < clusterMeans.length; index += 1) {
            total += clusterMeans[Math.floor(random() * clusterMeans.length)];
        }
        return total / clusterMeans.length;
    }).sort((left, right) => left - right);
    return [percentile(estimates, 0.025), percentile(estimates, 0.975)];
}
function auc(fractions, values) {
    return normalizedAcquisitionAuc(fractions.map((evidenceFraction, index) => ({
        evidenceFraction,
        verifiedAutomationCoverage: values[index],
    })));
}
function parseArgs(values) {
    let runSetPath = "research/robustness_v02_development_run_set.json";
    let outputPath;
    for (let index = 0; index < values.length; index += 1) {
        const token = values[index];
        const value = values[index + 1];
        if (token === "--run-set" && value) {
            runSetPath = value;
            index += 1;
        }
        else if (token === "--out" && value) {
            outputPath = value;
            index += 1;
        }
        else {
            throw new Error(`Unsupported argument ${token}.`);
        }
    }
    return { runSetPath, ...(outputPath ? { outputPath } : {}) };
}
const args = parseArgs(process.argv.slice(2));
const workspaceRoot = process.cwd();
const runSet = JSON.parse(await readFile(path.resolve(workspaceRoot, args.runSetPath), "utf8"));
if (runSet.schemaVersion !== 1 || new Set(runSet.runIds).size !== runSet.runIds.length) {
    throw new Error("Run set is invalid or contains duplicate run IDs.");
}
const units = [];
for (const runId of runSet.runIds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId))
        throw new Error(`Unsafe run ID ${runId}.`);
    const directory = path.join(workspaceRoot, "runs", runId);
    const [manifest, aggregate] = await Promise.all([
        readFile(path.join(directory, "manifest.json"), "utf8").then((value) => JSON.parse(value)),
        readFile(path.join(directory, "aggregate.json"), "utf8").then((value) => JSON.parse(value)),
    ]);
    if (manifest.benchmarkId !== runSet.benchmarkId ||
        aggregate.runStatus !== "valid" ||
        aggregate.evaluationSplit !== runSet.evaluationSplit ||
        manifest.hashes.aggregate !== hashArtifact(aggregate)) {
        throw new Error(`${runId} is inconsistent with its declared run set or manifest.`);
    }
    units.push({ runId, manifest, aggregate });
}
const expectedUnitCount = runSet.organizations.length * runSet.evidenceRegimes.length *
    runSet.checkpoints.length * runSet.trialSeeds.length;
if (units.length !== expectedUnitCount) {
    throw new Error(`Expected ${expectedUnitCount} units, received ${units.length}.`);
}
const implementationHashes = new Set(units.map((unit) => unit.manifest.hashes.implementation));
const promptHashes = new Set(units.map((unit) => unit.manifest.hashes.promptContract));
if (implementationHashes.size !== 1 || promptHashes.size !== 1) {
    throw new Error("Runs do not share one implementation and prompt contract.");
}
const pointGroups = new Map();
for (const unit of units) {
    for (const evaluation of unit.aggregate.gateEvaluations) {
        const key = [
            unit.aggregate.organizationId,
            unit.aggregate.evidenceRegime,
            unit.aggregate.trialSeed,
            evaluation.id,
        ].join(":");
        const group = pointGroups.get(key) ?? [];
        group.push({ unit, evaluation });
        pointGroups.set(key, group);
    }
}
const series = [...pointGroups.entries()].map(([key, group]) => {
    const sorted = [...group].sort((left, right) => left.unit.aggregate.evidenceFraction - right.unit.aggregate.evidenceFraction);
    const fractions = sorted.map((point) => point.unit.aggregate.evidenceFraction);
    if (JSON.stringify(fractions) !== JSON.stringify([0, 0.25, 0.5, 0.75, 1])) {
        throw new Error(`${key} does not contain the five acquisition checkpoints.`);
    }
    const first = sorted[0];
    return {
        organizationId: first.unit.aggregate.organizationId,
        evidenceRegime: first.unit.aggregate.evidenceRegime,
        gap: first.unit.aggregate.authoritativeEvidenceGapBatches,
        trialSeed: first.unit.aggregate.trialSeed,
        gate: first.evaluation.gate,
        verifier: first.evaluation.verifier,
        rawVacAuc: auc(fractions, sorted.map((point) => point.evaluation.verifiedAutomationCoverage)),
        safetyConstrainedVacAuc: auc(fractions, sorted.map((point) => point.evaluation.safetyConstrainedVac)),
        functionalAuc: auc(fractions, sorted.map((point) => point.evaluation.functionalPassRate)),
        violationExposureAuc: auc(fractions, sorted.map((point) => 1 - point.evaluation.policyPassRate)),
        groundingFailureExposureAuc: auc(fractions, sorted.map((point) => 1 - point.evaluation.groundingPassRate)),
        finalRawVac: sorted.at(-1).evaluation.verifiedAutomationCoverage,
        finalSafetyConstrainedVac: sorted.at(-1).evaluation.safetyConstrainedVac,
    };
});
const categorySeries = [...pointGroups.entries()].flatMap(([key, group]) => {
    const sorted = [...group].sort((left, right) => left.unit.aggregate.evidenceFraction - right.unit.aggregate.evidenceFraction);
    const first = sorted[0];
    if (first.evaluation.verifier.strategy !== "full")
        return [];
    const fractions = sorted.map((point) => point.unit.aggregate.evidenceFraction);
    const categories = Object.keys(first.evaluation.byCategory);
    return categories.map((category) => {
        const points = sorted.map((point) => {
            const value = point.evaluation.byCategory[category];
            if (!value)
                throw new Error(`${key} is missing category ${category}.`);
            return value;
        });
        return {
            organizationId: first.unit.aggregate.organizationId,
            evidenceRegime: first.unit.aggregate.evidenceRegime,
            trialSeed: first.unit.aggregate.trialSeed,
            gate: first.evaluation.gate,
            category,
            rawVacAuc: auc(fractions, points.map((point) => point.verifiedAutomationCoverage)),
            safetyConstrainedVacAuc: auc(fractions, points.map((point) => point.policyPassRate === 1 && point.groundingPassRate === 1
                ? point.verifiedAutomationCoverage
                : 0)),
            functionalAuc: auc(fractions, points.map((point) => point.functionalPassRate)),
            violationExposureAuc: auc(fractions, points.map((point) => 1 - point.policyPassRate)),
            groundingFailureExposureAuc: auc(fractions, points.map((point) => 1 - point.groundingPassRate)),
        };
    });
});
const main = series.filter((item) => item.verifier.strategy === "full");
const seriesKey = (item) => [item.organizationId, item.evidenceRegime, item.trialSeed].join(":");
function pairedDifference(treatment, baseline, metric, pairKey = seriesKey) {
    const baselineMap = new Map(baseline.map((item) => [pairKey(item), item]));
    return treatment.map((item) => {
        const pairId = pairKey(item);
        const match = baselineMap.get(pairId);
        if (!match)
            throw new Error(`Missing paired baseline for ${pairId}.`);
        return { organizationId: item.organizationId, pairId, value: item[metric] - match[metric] };
    });
}
function estimate(values) {
    return {
        estimate: mean(values.map((item) => item.value)),
        organizationClusterBootstrap95: organizationClusterInterval(values),
        organizationCount: new Set(values.map((item) => item.organizationId)).size,
        pairedSeriesCount: values.length,
    };
}
const subsetMain = main.filter((item) => item.gate === "safe-subset");
const bundleMain = main.filter((item) => item.gate === "bundle");
const directMain = main.filter((item) => item.gate === "direct");
const h1 = pairedDifference(subsetMain, bundleMain, "safetyConstrainedVacAuc");
const directGap0 = directMain.filter((item) => item.gap === 0);
const directGap3 = directMain.filter((item) => item.gap === 3);
const crossGapKey = (item) => `${item.organizationId}:${item.trialSeed}`;
const h2 = pairedDifference(directGap3, directGap0, "rawVacAuc", crossGapKey);
const gapEffectOnDirectViolationExposure = pairedDifference(directGap3, directGap0, "violationExposureAuc", crossGapKey);
const subsetGap0 = subsetMain.filter((item) => item.gap === 0);
const subsetGap3 = subsetMain.filter((item) => item.gap === 3);
const bundleGap0 = bundleMain.filter((item) => item.gap === 0);
const bundleGap3 = bundleMain.filter((item) => item.gap === 3);
const advantageGap0 = pairedDifference(subsetGap0, bundleGap0, "safetyConstrainedVacAuc");
const advantageGap3 = pairedDifference(subsetGap3, bundleGap3, "safetyConstrainedVacAuc");
const crossGapPairId = (item) => `${item.organizationId}:${item.pairId.split(":").at(-1)}`;
const advantageGap0Map = new Map(advantageGap0.map((item) => [crossGapPairId(item), item.value]));
const h3 = advantageGap3.map((item) => ({
    organizationId: item.organizationId,
    pairId: item.pairId,
    value: item.value - (advantageGap0Map.get(crossGapPairId(item)) ?? 0),
}));
function verifierPair(size, gate, metric) {
    const targeted = series.filter((item) => item.verifier.strategy === "authorization-critical" &&
        item.verifier.size === size && item.gate === gate);
    const uniform = series.filter((item) => item.verifier.strategy === "uniform" &&
        item.verifier.size === size && item.gate === gate);
    return estimate(pairedDifference(targeted, uniform, metric));
}
const byMainGateAndRegime = [...new Set(main.map((item) => `${item.gate}:${item.evidenceRegime}`))]
    .map((key) => {
    const [gate, evidenceRegime] = key.split(":");
    const selected = main.filter((item) => item.gate === gate && item.evidenceRegime === evidenceRegime);
    return {
        gate,
        evidenceRegime,
        seriesCount: selected.length,
        meanRawVacAuc: mean(selected.map((item) => item.rawVacAuc)),
        meanSafetyConstrainedVacAuc: mean(selected.map((item) => item.safetyConstrainedVacAuc)),
        meanFunctionalAuc: mean(selected.map((item) => item.functionalAuc)),
        meanViolationExposureAuc: mean(selected.map((item) => item.violationExposureAuc)),
        meanGroundingFailureExposureAuc: mean(selected.map((item) => item.groundingFailureExposureAuc)),
        meanFinalRawVac: mean(selected.map((item) => item.finalRawVac)),
        meanFinalSafetyConstrainedVac: mean(selected.map((item) => item.finalSafetyConstrainedVac)),
    };
});
const byCategory = [...new Set(categorySeries.map((item) => `${item.gate}:${item.evidenceRegime}:${item.category}`))].map((key) => {
    const [gate, evidenceRegime, category] = key.split(":");
    const selected = categorySeries.filter((item) => item.gate === gate &&
        item.evidenceRegime === evidenceRegime &&
        item.category === category);
    return {
        gate,
        evidenceRegime,
        category,
        seriesCount: selected.length,
        meanRawVacAuc: mean(selected.map((item) => item.rawVacAuc)),
        meanSafetyConstrainedVacAuc: mean(selected.map((item) => item.safetyConstrainedVacAuc)),
        meanFunctionalAuc: mean(selected.map((item) => item.functionalAuc)),
        meanViolationExposureAuc: mean(selected.map((item) => item.violationExposureAuc)),
        meanGroundingFailureExposureAuc: mean(selected.map((item) => item.groundingFailureExposureAuc)),
    };
});
const byCheckpoint = runSet.evidenceRegimes.flatMap((evidenceRegime) => ["direct", "bundle", "safe-subset"].flatMap((gate) => runSet.checkpoints.map((checkpoint) => {
    const evaluations = units
        .filter((unit) => unit.aggregate.evidenceRegime === evidenceRegime && unit.aggregate.checkpoint === checkpoint)
        .map((unit) => unit.aggregate.gateEvaluations.find((item) => item.gate === gate && item.verifier.strategy === "full"));
    return {
        evidenceRegime,
        gate,
        checkpoint,
        meanRawVac: mean(evaluations.map((item) => item.verifiedAutomationCoverage)),
        meanSafetyConstrainedVac: mean(evaluations.map((item) => item.safetyConstrainedVac)),
        meanPolicyFailureRate: mean(evaluations.map((item) => 1 - item.policyPassRate)),
    };
})));
const verifierSweep = [1, 2, 4].flatMap((size) => ["bundle", "safe-subset"].map((gate) => ({
    size,
    gate,
    authorizationCriticalMinusUniform: {
        safetyConstrainedVacAuc: verifierPair(size, gate, "safetyConstrainedVacAuc"),
        rawVacAuc: verifierPair(size, gate, "rawVacAuc"),
        violationExposureAuc: verifierPair(size, gate, "violationExposureAuc"),
    },
})));
const nonzeroUnits = units.filter((unit) => unit.aggregate.checkpoint > 0);
const promotionGranularity = {
    evaluatedCandidateCheckpoints: nonzeroUnits.length,
    partialSubsetRate: mean(nonzeroUnits.map((unit) => {
        const promotion = unit.aggregate.gateEvaluations.find((item) => item.gate === "safe-subset" && item.verifier.strategy === "full").promotion;
        return Number(promotion.promotedRuleCount > 0 && promotion.promotedRuleCount < promotion.candidateRuleCount);
    })),
    bundleAbstentionRate: mean(nonzeroUnits.map((unit) => {
        const promotion = unit.aggregate.gateEvaluations.find((item) => item.gate === "bundle" && item.verifier.strategy === "full").promotion;
        return Number(promotion.promotedRuleCount === 0);
    })),
    subsetRescueRate: mean(nonzeroUnits.map((unit) => {
        const bundle = unit.aggregate.gateEvaluations.find((item) => item.gate === "bundle" && item.verifier.strategy === "full").promotion;
        const subset = unit.aggregate.gateEvaluations.find((item) => item.gate === "safe-subset" && item.verifier.strategy === "full").promotion;
        return Number(bundle.promotedRuleCount === 0 && subset.promotedRuleCount > 0);
    })),
};
function riskCrossover(evidenceRegime) {
    const direct = byMainGateAndRegime.find((item) => item.gate === "direct" && item.evidenceRegime === evidenceRegime);
    const subset = byMainGateAndRegime.find((item) => item.gate === "safe-subset" && item.evidenceRegime === evidenceRegime);
    const avoidedViolationExposure = direct.meanViolationExposureAuc - subset.meanViolationExposureAuc;
    const functionalCost = direct.meanFunctionalAuc - subset.meanFunctionalAuc;
    return {
        evidenceRegime,
        functionalAucCostOfSafeSubset: functionalCost,
        violationExposureAucAvoided: avoidedViolationExposure,
        lambdaCrossover: avoidedViolationExposure > 0
            ? functionalCost / avoidedViolationExposure
            : null,
    };
}
const summary = {
    schemaVersion: 1,
    benchmarkId: runSet.benchmarkId,
    evaluationSplit: runSet.evaluationSplit,
    scientificStatus: runSet.evaluationSplit === "hidden"
        ? "confirmatory-hidden-aggregate"
        : "exploratory-development-only",
    sourceRunSet: args.runSetPath,
    sourceRunSetHash: hashArtifact(runSet),
    implementationHash: [...implementationHashes][0],
    promptContractHash: [...promptHashes][0],
    uncertaintyProtocol: {
        unit: "organization cluster; model trials and evidence regimes remain paired within organization",
        replicates: BOOTSTRAP_REPLICATES,
        seed: BOOTSTRAP_SEED,
        interval: "percentile 95%",
    },
    confirmatoryTests: {
        H1_safeSubsetMinusBundleSafetyConstrainedVacAuc: estimate(h1),
        H2_gap3MinusGap0DirectRawVacAuc: estimate(h2),
        H3_gapInteractionOnSafeSubsetMinusBundleSafetyConstrainedVacAuc: estimate(h3),
        H4_size2SafeSubsetAuthorizationCriticalMinusUniformViolationExposureAuc: verifierPair(2, "safe-subset", "violationExposureAuc"),
    },
    mandatorySecondary: {
        gap3MinusGap0DirectViolationExposureAuc: estimate(gapEffectOnDirectViolationExposure),
        safeSubsetMinusBundleRawVacAuc: estimate(pairedDifference(subsetMain, bundleMain, "rawVacAuc")),
        safeSubsetMinusDirectSafetyConstrainedVacAuc: estimate(pairedDifference(subsetMain, directMain, "safetyConstrainedVacAuc")),
        safeSubsetMinusDirectRawVacAuc: estimate(pairedDifference(subsetMain, directMain, "rawVacAuc")),
    },
    byMainGateAndRegime,
    byCategory,
    byCheckpoint,
    verifierSweep,
    promotionGranularity,
    riskCrossovers: runSet.evidenceRegimes.map(riskCrossover),
    accounting: {
        unitCount: units.length,
        providerCalls: units.reduce((sum, unit) => sum + unit.aggregate.modelGateway.providerCalls, 0),
        billableCostUsd: units.reduce((sum, unit) => sum + (unit.aggregate.billableUsage?.costUsd ?? 0), 0),
        attributedCostUsd: units.reduce((sum, unit) => sum + unit.aggregate.attributedUsage.costUsd, 0),
    },
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (args.outputPath) {
    await writeFile(path.resolve(workspaceRoot, args.outputPath), serialized, "utf8");
}
process.stdout.write(serialized);
//# sourceMappingURL=summarize-robustness.js.map