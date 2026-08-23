import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
    regressionScanArtifactSchemaVersion,
    type RegressionFinding,
    type RegressionScanArtifact,
} from '../types/regressionTypes';
import { assertValidPluginId } from './approvedFindings';

interface AggregatedFinding extends RegressionFinding {
    plugin: string;
}

const requiredEnvironmentValue = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    return value;
};

const isSafeRelativeFile = (file: string) => {
    return file.length > 0
        && !file.includes('\\')
        && !file.startsWith('/')
        && file.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
};

const isRegressionFinding = (value: unknown): value is RegressionFinding => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const finding = value as Record<string, unknown>;
    return typeof finding.ruleId === 'string' && finding.ruleId.length > 0
        && typeof finding.file === 'string' && isSafeRelativeFile(finding.file)
        && Number.isInteger(finding.line) && (finding.line as number) > 0
        && typeof finding.container === 'string' && finding.container.length > 0
        && typeof finding.fingerprint === 'string'
        && /^sha256:[a-f0-9]{64}$/.test(finding.fingerprint);
};

const parseRegressionArtifact = (value: unknown, source: string): RegressionScanArtifact => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${source} must contain an object.`);
    }

    const artifact = value as Record<string, unknown>;
    if (
        artifact.schemaVersion !== regressionScanArtifactSchemaVersion
        || typeof artifact.plugin !== 'string' || !artifact.plugin.trim()
        || typeof artifact.pluginId !== 'string'
        || !Array.isArray(artifact.findings) || !artifact.findings.every(isRegressionFinding)
    ) {
        throw new Error(`${source} is not a valid regression scan artifact.`);
    }

    assertValidPluginId(artifact.pluginId);
    return artifact as unknown as RegressionScanArtifact;
};

const markdownTableCell = (value: string) => {
    return value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
};

const findingsTable = (findings: AggregatedFinding[]) => {
    const sorted = [...findings].sort((a, b) => {
        return a.plugin.localeCompare(b.plugin)
            || a.ruleId.localeCompare(b.ruleId)
            || a.file.localeCompare(b.file)
            || a.line - b.line
            || a.fingerprint.localeCompare(b.fingerprint);
    });
    const rows = sorted.map(finding => {
        return `| ${markdownTableCell(finding.plugin)} | ${markdownTableCell(finding.ruleId)} | ${markdownTableCell(finding.file)} | ${finding.line} | ${markdownTableCell(finding.container)} | ${finding.fingerprint} |`;
    });

    return [
        '| Plugin | Rule ID | File | Line | Container | Fingerprint |',
        '| --- | --- | --- | ---: | --- | --- |',
        ...rows,
    ].join('\n');
};

const appendStepSummary = async (content: string, summaryPath = process.env.GITHUB_STEP_SUMMARY) => {
    if (!summaryPath) {
        throw new Error('GITHUB_STEP_SUMMARY is not set; cannot write the regression result to the Actions summary.');
    }
    await appendFile(summaryPath, `${content.trimEnd()}\n\n`, 'utf8');
};

const findJsonFiles = async (dir: string): Promise<string[]> => {
    let files: string[] = [];
    for (const item of await readdir(dir)) {
        const fullPath = join(dir, item);
        if ((await stat(fullPath)).isDirectory()) {
            files = files.concat(await findJsonFiles(fullPath));
        } else if (item === 'findings.json') {
            files.push(fullPath);
        }
    }
    return files;
};

const withPlugin = (plugin: string, findings: RegressionFinding[]): AggregatedFinding[] => {
    return findings.map(finding => ({ plugin, ...finding }));
};

const main = async () => {
    try {
        const artifactsDir = process.env.ARTIFACTS_DIR || resolve('findings');
        const expectedPluginCount = Number.parseInt(requiredEnvironmentValue('EXPECTED_PLUGIN_COUNT'), 10);
        const scanResult = requiredEnvironmentValue('SCAN_RESULT');
        const downloadOutcome = requiredEnvironmentValue('DOWNLOAD_OUTCOME');
        const allFindings: AggregatedFinding[] = [];
        const incompleteReasons: string[] = [];
        const plugins = new Set<string>();
        const pluginIds = new Set<string>();

        if (!Number.isInteger(expectedPluginCount) || expectedPluginCount < 1) {
            throw new Error(`Invalid EXPECTED_PLUGIN_COUNT: ${process.env.EXPECTED_PLUGIN_COUNT}`);
        }
        if (scanResult !== 'success') {
            incompleteReasons.push(`The scan matrix result was ${scanResult}, not success.`);
        }
        if (downloadOutcome !== 'success') {
            incompleteReasons.push(`The findings artifact download result was ${downloadOutcome}, not success.`);
        }

        let jsonFiles: string[] = [];
        try {
            jsonFiles = await findJsonFiles(artifactsDir);
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            incompleteReasons.push(`Could not read the findings artifacts: ${details}`);
        }
        if (jsonFiles.length !== expectedPluginCount) {
            incompleteReasons.push(`Expected ${expectedPluginCount} findings artifacts, but found ${jsonFiles.length}.`);
        }

        for (const file of jsonFiles) {
            try {
                const artifact = parseRegressionArtifact(JSON.parse(await readFile(file, 'utf8')), file);
                if (plugins.has(artifact.plugin)) {
                    throw new Error(`Duplicate artifact for plugin ${artifact.plugin}.`);
                }
                if (pluginIds.has(artifact.pluginId)) {
                    throw new Error(`Duplicate artifact for plugin ID ${artifact.pluginId}.`);
                }

                plugins.add(artifact.plugin);
                pluginIds.add(artifact.pluginId);
                allFindings.push(...withPlugin(artifact.plugin, artifact.findings));
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                incompleteReasons.push(`Could not parse ${file}: ${details}`);
            }
        }

        if (plugins.size !== expectedPluginCount) {
            incompleteReasons.push(`Expected ${expectedPluginCount} unique plugin results, but validated ${plugins.size}.`);
        }

        if (incompleteReasons.length > 0) {
            const summary = [
                '## CodeQL regression scan incomplete',
                '',
                'The regression result cannot be considered clean because not every configured plugin produced a valid result.',
                '',
                ...incompleteReasons.map(reason => `- ${reason}`),
            ];
            if (allFindings.length > 0) {
                summary.push('', '### Findings collected before failure', '', findingsTable(allFindings));
            }

            await appendStepSummary(summary.join('\n'));
            process.exit(1);
        }

        if (allFindings.length === 0) {
            await appendStepSummary(
                `## CodeQL regression scan passed\n\nNo findings were reported across all ${plugins.size} tested plugins.`,
            );
            process.exit(0);
        }

        await appendStepSummary(`## CodeQL regression findings\n\n${findingsTable(allFindings)}`);
        process.exit(1);
    } catch (error) {
        console.error('Aggregation failed:', error);
        process.exit(1);
    }
};

if (require.main === module) void main();
