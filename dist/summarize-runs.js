import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashArtifact } from "./eval/manifest.js";
import { normalizedAcquisitionAuc } from "./eval/metrics.js";
const BOOTSTRAP_SEED = 20260820;
const BOOTSTRAP_REPLICATES = 10_000;
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
function percentile(sortedValues, probability) {
    if (sortedValues.length === 0) {
        throw new Error("Cannot take a percentile of an empty sample.");
    }
    const index = (sortedValues.length - 1) * probability;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
function pairedBootstrapInterval(values) {
    if (values.length === 0) {
        throw new Error("Cannot bootstrap an empty paired sample.");
    }
    const random = seededRandom(BOOTSTRAP_SEED);
    const means = Array.from({ length: BOOTSTRAP_REPLICATES }, () => {
        let total = 0;
        for (let index = 0; index < values.length; index += 1) {
            total += values[Math.floor(random() * values.length)];
        }
        return total / values.length;
    }).sort((left, right) => left - right);
    return [percentile(means, 0.025), percentile(means, 0.975)];
}
function parseArgs(values) {
    let runSetPath = "research/development_run_set.json";
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
const declaredTrialSeeds = runSet.trialSeeds ??
    (runSet.trialSeed === undefined ? [] : [runSet.trialSeed]);
if (declaredTrialSeeds.length === 0 ||
    new Set(declaredTrialSeeds).size !== declaredTrialSeeds.length) {
    throw new Error("Run set must declare one or more unique trial seeds.");
}
const units = [];
for (const runId of runSet.runIds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) {
        throw new Error(`Unsafe run ID ${runId}.`);
    }
    const runDirectory = path.join(workspaceRoot, "runs", runId);
    const [manifest, aggregate] = await Promise.all([
        readFile(path.join(runDirectory, "manifest.json"), "utf8").then((value) => JSON.parse(value)),
        readFile(path.join(runDirectory, "aggregate.json"), "utf8").then((value) => JSON.parse(value)),
    ]);
    if (manifest.benchmarkId !== runSet.benchmarkId) {
        throw new Error(`${runId} uses benchmark ${manifest.benchmarkId}.`);
    }
    if (manifest.method !== aggregate.conditionId) {
        throw new Error(`${runId} has inconsistent method metadata.`);
    }
    if (aggregate.runStatus !== "valid" ||
        aggregate.evaluationSplit !== runSet.evaluationSplit ||
        !declaredTrialSeeds.includes(aggregate.trialSeed)) {
        throw new Error(`${runId} is not a valid member of the declared run set.`);
    }
    if (manifest.hashes.aggregate !== hashArtifact(aggregate)) {
        throw new Error(`${runId} aggregate hash does not match its manifest.`);
    }
    units.push({ runId, manifest, aggregate });
}
const implementationHashes = new Set(units.map((unit) => unit.manifest.hashes.implementation));
const promptHashes = new Set(units.map((unit) => unit.manifest.hashes.promptContract));
if (implementationHashes.size !== 1 || promptHashes.size !== 1) {
    throw new Error("Selected runs do not share one implementation and prompt contract.");
}
const groups = new Map();
for (const unit of units) {
    const key = `${unit.aggregate.conditionId}:${unit.aggregate.organizationId}:${unit.aggregate.trialSeed}`;
    const group = groups.get(key) ?? [];
    group.push(unit);
    groups.set(key, group);
}
const byExperimentalSeries = [...groups.entries()].map(([key, group]) => {
    const sorted = [...group].sort((left, right) => left.aggregate.evidenceFraction - right.aggregate.evidenceFraction);
    const fractions = sorted.map((unit) => unit.aggregate.evidenceFraction);
    if (JSON.stringify(fractions) !== JSON.stringify([0, 0.25, 0.5, 0.75, 1])) {
        throw new Error(`${key} does not contain exactly the five acquisition checkpoints.`);
    }
    const rawCurve = sorted.map((unit) => unit.aggregate.verifiedAutomationCoverage);
    const safetyConstrainedCurve = sorted.map((unit) => unit.aggregate.safetyConstrainedVac);
    const auc = (curve) => normalizedAcquisitionAuc(fractions.map((evidenceFraction, index) => ({
        evidenceFraction,
        verifiedAutomationCoverage: curve[index],
    })));
    return {
        conditionId: sorted[0].aggregate.conditionId,
        organizationId: sorted[0].aggregate.organizationId,
        trialSeed: sorted[0].aggregate.trialSeed,
        evidenceFractions: fractions,
        rawVac: rawCurve,
        safetyConstrainedVac: safetyConstrainedCurve,
        rawVacAuc: auc(rawCurve),
        safetyConstrainedVacAuc: auc(safetyConstrainedCurve),
        finalVac: rawCurve.at(-1),
        minimumPolicyPassRate: Math.min(...sorted.map((unit) => unit.aggregate.policyPassRate)),
        minimumGroundingPassRate: Math.min(...sorted.map((unit) => unit.aggregate.groundingPassRate)),
        attributedInputTokens: sorted.reduce((sum, unit) => sum + unit.aggregate.attributedUsage.inputTokens, 0),
        attributedOutputTokens: sorted.reduce((sum, unit) => sum + unit.aggregate.attributedUsage.outputTokens, 0),
        attributedCostUsd: sorted.reduce((sum, unit) => sum + unit.aggregate.attributedUsage.costUsd, 0),
        selectedRunIds: sorted.map((unit) => unit.runId),
    };
});
const conditionIds = [...new Set(byExperimentalSeries.map((series) => series.conditionId))];
const byCondition = conditionIds.map((conditionId) => {
    const series = byExperimentalSeries.filter((item) => item.conditionId === conditionId);
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        conditionId,
        experimentalSeriesCount: series.length,
        organizationCount: new Set(series.map((item) => item.organizationId)).size,
        trialCount: new Set(series.map((item) => item.trialSeed)).size,
        meanSafetyConstrainedVacAuc: mean(series.map((item) => item.safetyConstrainedVacAuc)),
        meanRawVacAuc: mean(series.map((item) => item.rawVacAuc)),
        meanFinalVac: mean(series.map((item) => item.finalVac ?? 0)),
        attributedCostUsd: series.reduce((sum, item) => sum + item.attributedCostUsd, 0),
    };
});
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pairedComparisons = conditionIds.flatMap((baselineConditionId, baselineIndex) => conditionIds.slice(baselineIndex + 1).map((treatmentConditionId) => {
    const baseline = new Map(byExperimentalSeries
        .filter((series) => series.conditionId === baselineConditionId)
        .map((series) => [`${series.organizationId}:${series.trialSeed}`, series]));
    const pairs = byExperimentalSeries
        .filter((series) => series.conditionId === treatmentConditionId)
        .flatMap((series) => {
        const matchingBaseline = baseline.get(`${series.organizationId}:${series.trialSeed}`);
        return matchingBaseline ? [{ baseline: matchingBaseline, treatment: series }] : [];
    });
    if (pairs.length === 0) {
        return undefined;
    }
    const safetyDifferences = pairs.map(({ baseline: left, treatment: right }) => right.safetyConstrainedVacAuc - left.safetyConstrainedVacAuc);
    const rawDifferences = pairs.map(({ baseline: left, treatment: right }) => right.rawVacAuc - left.rawVacAuc);
    return {
        baselineConditionId,
        treatmentConditionId,
        matchedOrganizationTrialSeries: pairs.length,
        organizationCount: new Set(pairs.map(({ treatment: item }) => item.organizationId)).size,
        trialCount: new Set(pairs.map(({ treatment: item }) => item.trialSeed)).size,
        safetyConstrainedVacAucDifference: mean(safetyDifferences),
        safetyConstrainedVacAucDifferenceBootstrap95: pairedBootstrapInterval(safetyDifferences),
        rawVacAucDifference: mean(rawDifferences),
        rawVacAucDifferenceBootstrap95: pairedBootstrapInterval(rawDifferences),
    };
})).filter((comparison) => comparison !== undefined);
const summary = {
    schemaVersion: 1,
    sourceRunSet: args.runSetPath,
    sourceRunSetHash: hashArtifact(runSet),
    benchmarkId: runSet.benchmarkId,
    evaluationSplit: runSet.evaluationSplit,
    scientificStatus: runSet.evaluationSplit === "hidden"
        ? "confirmatory-hidden-aggregate"
        : "exploratory-development-only",
    implementationHash: [...implementationHashes][0],
    promptContractHash: [...promptHashes][0],
    uncertaintyProtocol: {
        unit: "paired organization-trial acquisition series",
        replicates: BOOTSTRAP_REPLICATES,
        seed: BOOTSTRAP_SEED,
        interval: "percentile 95%",
        scope: "Quantifies variation among four organizations and three model trials; organization-level estimates remain mandatory because four organizations do not support broad population inference.",
    },
    byExperimentalSeries,
    byCondition,
    pairedComparisons,
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (args.outputPath) {
    await writeFile(path.resolve(workspaceRoot, args.outputPath), serialized, "utf8");
}
process.stdout.write(serialized);
//# sourceMappingURL=summarize-runs.js.map