import { readFile } from 'fs/promises';
import type {
    FinalReportInput,
    PhaseMap,
    SarifReport,
    SarifRule,
    SarifResult,
} from '../types/types';
import { buildPhaseMap, escapeInlineCode, escapeMarkdownText, escapeMarkdownUrl, fileExists, toRepoRelativeFile } from '../utils/utils';

const phaseCount = 5;

// Get the phase status 
export const getPhases = (currentPhase: number) => {
    return buildPhaseMap(currentPhase, phaseCount);
};

// Creates the comment template that helps us track what Phase is currently going on 
export const statusTemplate = (repoUrl: string, commitHash: string, runUrl: string, phases: PhaseMap | null, isUpdate?: boolean) => {
    const targetText = escapeMarkdownText(`${repoUrl}/tree/${commitHash}`);
    const targetUrl = escapeMarkdownUrl(`${repoUrl}/tree/${commitHash}`);
    const workflowRunUrl = escapeMarkdownUrl(runUrl);

    let base = `# Security Scan Report\n`;
    if (isUpdate !== undefined) {
        const typeStr = isUpdate ? 'Update' : 'New Plugin';
        base += `**Submission Type:** ${typeStr}\n`;
    }

    base += `**Target:** [${targetText}](${targetUrl})\n**Workflow Run:** [View Logs](${workflowRunUrl})`;

    if (!phases) return base;

    return `${base}

# Pipeline Status
* ${phases[1]} **Phase 1: Identity & Uniqueness Check**
* ${phases[2]} **Phase 2: Environment Provisioning**
* ${phases[3]} **Phase 3: CodeQL Database Compilation**
* ${phases[4]} **Phase 4: SAST Taint Analysis**
* ${phases[5]} **Phase 5: Final Report Generation**`;
};

export const extractReportMetadata = (body: string) => {
    const repoUrlMatch = body.match(/\*\*Target:\*\* \[([^\]]+)\/(?:commit|tree)\//);
    const commitHashMatch = body.match(/\*\*Target:\*\* \[.*?\/(?:commit|tree)\/([^\]]+)\]/);
    const runUrlMatch = body.match(/\*\*Workflow Run:\*\* \[.*?\]\(([^)]+)\)/);

    const typeMatch = body.match(/\*\*Submission Type:\*\* (Update|New Plugin)/);
    let isUpdate: boolean | undefined = undefined;
    if (typeMatch) {
        isUpdate = typeMatch[1] === 'Update';
    }

    return {
        repoUrl: repoUrlMatch ? repoUrlMatch[1] : '',
        commitHash: commitHashMatch ? commitHashMatch[1] : '',
        runUrl: runUrlMatch ? runUrlMatch[1] : '',
        isUpdate,
    };
};

const toGitHubBlobUrl = (repoUrl: string, commitHash: string, file: string, line: number) => {
    const filePath = file.split('/').map(encodeURIComponent).join('/');
    return `${repoUrl}/blob/${commitHash}/${filePath}#L${line}`;
};

const readSarif = async (sarifPath: string) => {
    const parsed: unknown = JSON.parse(await readFile(sarifPath, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as SarifReport).runs)) {
        throw new Error('The SARIF report does not contain a valid runs array.');
    }

    const sarif = parsed as SarifReport;
    if (sarif.runs.length === 0) {
        throw new Error('The SARIF report does not contain any analysis runs.');
    }

    for (const run of sarif.runs) {
        if (!run || typeof run !== 'object' || (run.results !== undefined && !Array.isArray(run.results))) {
            throw new Error('The SARIF report contains an invalid analysis run.');
        }
    }

    return sarif;
};

// Gives an array of all the results
const sarifResults = (sarif: SarifReport) => {
    return sarif.runs.flatMap(run => run.results ?? []);
};

// find the rule inside 'run.tool.driver' or `run.tool.extensions` to find
// more information about the rules
const findRule = (sarif: SarifReport, ruleId: string) => {
    for (const run of sarif.runs) {
        const rules = run.tool?.driver?.rules ?? [];
        let foundRule = rules.find(rule => rule.id === ruleId);

        if (foundRule) return foundRule;

        if (run.tool?.extensions) {
            for (const extension of run.tool.extensions) {
                const extRules = extension.rules ?? [];
                foundRule = extRules.find(rule => rule.id === ruleId);
                if (foundRule) return foundRule;
            }
        }
    }

    return null;
};

// Find the severity of the result 
// If failed to get an severity defaults to 'warning'
const getSeverityLevel = (rule: SarifRule | null) => {
    const configuredLevel = rule?.defaultConfiguration?.level;
    if (configuredLevel) return configuredLevel;

    return rule?.properties?.['problem.severity'] === 'error' ? 'error' : 'warning';
};

const severityRank = (severityLevel: string) => {
    if (severityLevel === 'error') return 0;
    if (severityLevel === 'warning') return 1;
    return 2;
};

const severityIcon = (rule: SarifRule | null) => {
    const severityLevel = getSeverityLevel(rule);

    if (severityLevel === 'error') return '🔴 Critical';
    if (severityLevel === 'warning') return '🟡 Warning';
    return '🔵 Info';
};

// renders finding in reviewer friendly way 
const renderSarifFinding = (sarif: SarifReport, result: SarifResult, repoUrl: string, commitHash: string) => {
    const rule = findRule(sarif, result.ruleId);
    const rawMessage = result.message?.text ?? '';
    const message = Array.from(new Set(rawMessage.split('\n').map(value => value.trim())))
        .filter(Boolean)
        .join(' ');
    const title = rule?.shortDescription?.text ?? rule?.name ?? result.ruleId;

    // Find the file path where the vulnerability was found 
    const location = result.locations?.[0]?.physicalLocation;
    const file = toRepoRelativeFile(location?.artifactLocation?.uri ?? '');
    const line = location?.region?.startLine ?? 1;
    const locationUrl = escapeMarkdownUrl(toGitHubBlobUrl(repoUrl, commitHash, file, line));

    return `### ${severityIcon(rule)}: ${escapeMarkdownText(title)}
* **Rule Violated:** \`${escapeInlineCode(result.ruleId)}\`
* **Flagged For:** ${escapeMarkdownText(message)}
* **Location:** [\`${escapeInlineCode(`${file}#L${line}`)}\`](${locationUrl})

`;
};

const failedReport = (
    repoUrl: string,
    commitHash: string,
    runUrl: string,
    reason: string,
    isUpdate?: boolean,
) => {
    const header = statusTemplate(repoUrl, commitHash, runUrl, null, isUpdate)
        .replace('# Security Scan Report', '# Security Scan Failed');

    return {
        ok: false as const,
        body: `${header}\n\n---\n\n❌ ${escapeMarkdownText(reason)}\n\nThe issue remains open so the scan can be investigated or retried.\n`,
        error: reason,
    };
};

export const renderFinalReport = async ({
    sarifPath,
    repoUrl,
    commitHash,
    runUrl,
    analysisOutcome,
    isUpdate,
}: FinalReportInput) => {
    if (analysisOutcome !== 'success') {
        return failedReport(
            repoUrl,
            commitHash,
            runUrl,
            `CodeQL analysis did not complete successfully (outcome: ${analysisOutcome}). Check the workflow logs for details.`,
            isUpdate,
        );
    }

    const reportHeader = `${statusTemplate(repoUrl, commitHash, runUrl, null, isUpdate)}\n\n---\n# Findings\n\n`;

    if (!(await fileExists(sarifPath))) {
        return failedReport(
            repoUrl,
            commitHash,
            runUrl,
            'CodeQL completed without producing the expected SARIF report. Check the workflow logs for details.',
            isUpdate,
        );
    }

    let sarif: SarifReport;
    try {
        sarif = await readSarif(sarifPath);
    } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        return failedReport(
            repoUrl,
            commitHash,
            runUrl,
            `The SARIF report is malformed or incomplete: ${details} Check the workflow logs for details.`,
            isUpdate,
        );
    }

    const results = sarifResults(sarif);

    if (results.length === 0) {
        return { ok: true as const, body: `${reportHeader}✅ No vulnerabilities detected by CodeQL.\n` };
    }

    // shows error findings above warning findings
    const sortedResults = [...results].sort((a, b) => {
        const ruleA = findRule(sarif, a.ruleId);
        const ruleB = findRule(sarif, b.ruleId);

        const levelA = getSeverityLevel(ruleA);
        const levelB = getSeverityLevel(ruleB);

        return severityRank(levelA) - severityRank(levelB);
    });

    const findings = sortedResults.map(result => renderSarifFinding(sarif, result, repoUrl, commitHash)).join('');

    return { ok: true as const, body: `${reportHeader}${findings}` };
};
