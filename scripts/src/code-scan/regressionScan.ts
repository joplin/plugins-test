import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FingerprintedSarifResult } from '../types/approvedFindings';
import {
    regressionScanArtifactSchemaVersion,
    type RegressionFinding,
    type RegressionScanArtifact,
} from '../types/regressionTypes';
import type { SarifReport } from '../types/types';
import { assertValidPluginId, fingerprintSarifResults } from './approvedFindings';

const requiredEnvironmentValue = (name: string) => {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} is required.`);
    }

    return value;
};

export const parseSarif = async (resultsSarif: string) => {
    const parsed: unknown = JSON.parse(await readFile(resultsSarif, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as SarifReport).runs)) {
        throw new Error(`Invalid SARIF report: ${resultsSarif}`);
    }

    return parsed as SarifReport;
};

const regressionFindingFrom = (finding: FingerprintedSarifResult): RegressionFinding => ({
    ruleId: finding.identity.ruleId,
    file: finding.identity.file,
    line: finding.identity.lineHint,
    container: finding.identity.container,
    fingerprint: finding.identity.fingerprint,
});

export const main = async () => {
    try {
        const resultsSarif = requiredEnvironmentValue('RESULTS_SARIF');
        const pluginName = requiredEnvironmentValue('PLUGIN_NAME');
        const sourceRoot = requiredEnvironmentValue('SOURCE_ROOT');
        const report = await parseSarif(resultsSarif);
        const manifestPath = resolve(sourceRoot, 'src', 'manifest.json');
        const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
            throw new Error(`Invalid plugin manifest: ${manifestPath}`);
        }

        const pluginId = (manifest as Record<string, unknown>).id;
        try {
            assertValidPluginId(pluginId);
        } catch {
            throw new Error(`Plugin manifest has an invalid id: ${manifestPath}`);
        }

        const fingerprinted = await fingerprintSarifResults(report, sourceRoot);
        const artifact: RegressionScanArtifact = {
            schemaVersion: regressionScanArtifactSchemaVersion,
            plugin: pluginName,
            pluginId,
            findings: fingerprinted.map(regressionFindingFrom),
        };

        await writeFile('findings.json', `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
        process.exit(0);
    } catch (error) {
        console.error(`CodeQL regression scan failed:`, error);
        process.exit(1);
    }
};

if (require.main === module) void main();
