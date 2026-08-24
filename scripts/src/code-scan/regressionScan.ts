import { readFile, writeFile } from 'node:fs/promises';
import type {
    Finding,
    RegressionSarifReport,
    RegressionSarifResult,
} from '../types/regressionTypes';
import { requiredEnvironmentValue, toRepoRelativeFile } from '../utils/utils';

const isObject = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value);
};

const parseSarif = async (resultsSarif: string): Promise<RegressionSarifReport> => {
    const parsed: unknown = JSON.parse(await readFile(resultsSarif, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as RegressionSarifReport).runs)) {
        throw new Error(`Invalid SARIF report: ${resultsSarif}`);
    }

    for (const run of (parsed as RegressionSarifReport).runs ?? []) {
        if (!isObject(run) || (run.results !== undefined && !Array.isArray(run.results))) {
            throw new Error(`Invalid SARIF analysis run: ${resultsSarif}`);
        }

        for (const result of run.results ?? []) {
            if (!isObject(result)) {
                throw new Error(`Invalid SARIF result: ${resultsSarif}`);
            }

            const locations = result.locations;
            if (locations === undefined) continue;

            if (!Array.isArray(locations)) {
                throw new Error(`Invalid SARIF result locations: ${resultsSarif}`);
            }

            if (locations.some(location => !isObject(location))) {
                throw new Error(`Invalid SARIF result location: ${resultsSarif}`);
            }
        }
    }

    return parsed as RegressionSarifReport;
};

const findingsFrom = (report: RegressionSarifReport): RegressionSarifResult[] => {
    return (report.runs ?? []).flatMap(run => run.results ?? []);
};

const ruleIdFor = (finding: RegressionSarifResult): string => {
    return finding.ruleId ?? finding.rule?.id ?? 'unknown-rule';
};

const main = async (): Promise<void> => {
    try {
        const resultsSarif = requiredEnvironmentValue('RESULTS_SARIF');
        const pluginName = requiredEnvironmentValue('PLUGIN_NAME');
        const report = await parseSarif(resultsSarif);
        const findings = findingsFrom(report);

        const extractedFindings: Finding[] = findings.flatMap(finding => {
            const locations = finding.locations ?? [];
            const ruleId = ruleIdFor(finding);

            if (locations.length === 0) {
                return [{ plugin: pluginName, ruleId, file: 'unknown file', line: '-' }];
            }

            return locations.map(location => {
                const file = toRepoRelativeFile(location.physicalLocation?.artifactLocation?.uri);
                const line = location.physicalLocation?.region?.startLine?.toString() ?? '-';
                return { plugin: pluginName, ruleId, file, line };
            });
        });

        await writeFile('findings.json', `${JSON.stringify(extractedFindings, null, 2)}\n`, 'utf8');
    } catch (error) {
        console.error(`CodeQL regression scan failed:`, error);
        process.exitCode = 1;
    }
};

if (require.main === module) void main();
