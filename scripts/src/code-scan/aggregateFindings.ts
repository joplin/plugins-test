import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Finding } from '../types/regressionTypes';

const requiredEnvironmentValue = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    return value;
};

const isFinding = (value: unknown): value is Finding => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const finding = value as Record<string, unknown>;
    return typeof finding.plugin === 'string'
        && typeof finding.ruleId === 'string'
        && typeof finding.file === 'string'
        && typeof finding.line === 'string';
};

const markdownTableCell = (value: string) => {
    return value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
};

const findingsTable = (findings: Finding[]) => {
    const rows = findings.map(finding => {
        return `| ${markdownTableCell(finding.plugin)} | ${markdownTableCell(finding.ruleId)} | ${markdownTableCell(finding.file)} | ${markdownTableCell(finding.line)} |`;
    });

    return [
        '| Plugin | Rule ID | File | Line |',
        '| --- | --- | --- | ---: |',
        ...rows,
    ].join('\n');
};

const appendStepSummary = async (content: string, summaryPath = process.env.GITHUB_STEP_SUMMARY) => {
    if (!summaryPath) {
        throw new Error('GITHUB_STEP_SUMMARY is not set; cannot write the regression result to the Actions summary.');
    }
    await appendFile(summaryPath, `${content.trimEnd()}\n\n`, 'utf8');
};

const main = async () => {
    try {
        const artifactsDir = process.env.ARTIFACTS_DIR || resolve('findings');
        const expectedPluginCount = Number.parseInt(requiredEnvironmentValue('EXPECTED_PLUGIN_COUNT'), 10);
        const scanResult = requiredEnvironmentValue('SCAN_RESULT');
        const downloadOutcome = requiredEnvironmentValue('DOWNLOAD_OUTCOME');
        const allFindings: Finding[] = [];
        const incompleteReasons: string[] = [];

        if (!Number.isInteger(expectedPluginCount) || expectedPluginCount < 1) {
            throw new Error(`Invalid EXPECTED_PLUGIN_COUNT: ${process.env.EXPECTED_PLUGIN_COUNT}`);
        }

        if (scanResult !== 'success') {
            incompleteReasons.push(`The scan matrix result was ${scanResult}, not success.`);
        }

        if (downloadOutcome !== 'success') {
            incompleteReasons.push(`The findings artifact download result was ${downloadOutcome}, not success.`);
        }

        // Search recursively for findings.json files
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
                const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
                if (!Array.isArray(parsed) || !parsed.every(isFinding)) {
                    throw new Error('The file must contain an array of valid findings.');
                }

                const data = parsed as Finding[];
                allFindings.push(...data);
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                incompleteReasons.push(`Could not parse ${file}: ${details}`);
            }
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
                summary.push(
                    '',
                    `### Findings collected before failure (${allFindings.length})`,
                    '',
                    findingsTable(allFindings),
                );
            }

            await appendStepSummary(summary.join('\n'));
            process.exit(1);
        }

        if (allFindings.length === 0) {
            await appendStepSummary('## CodeQL regression scan passed\n\nNo findings were reported across all tested plugins.');
            process.exit(0);
        }

        const table = [
            '## CodeQL regression findings',
            '',
            `Found ${allFindings.length} finding${allFindings.length === 1 ? '' : 's'} across the tested safe plugins.`,
            '',
            findingsTable(allFindings),
        ].join('\n');

        await appendStepSummary(table);
        process.exit(1);

    } catch (error) {
        console.error('Aggregation failed:', error);
        process.exit(1);
    }
};

if (require.main === module) void main();
