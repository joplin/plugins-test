import type { PublishPayload } from '../types/publishTypes';
import { buildPhaseMap, escapeMarkdownText, escapeMarkdownUrl } from '../utils/utils';

const phaseCount = 6;

export const statusTemplate = (
    payload: PublishPayload,
    runUrl: string,
    currentPhase: number,
    details?: string,
): string => {
    const phases = buildPhaseMap(currentPhase, phaseCount);
    const targetText = escapeMarkdownText(`${payload.repository_url}/tree/${payload.commit_hash}`);
    const targetUrl = escapeMarkdownUrl(`${payload.repository_url}/tree/${payload.commit_hash}`);
    const workflowRunUrl = escapeMarkdownUrl(runUrl);
    const escapedDetails = details ? escapeMarkdownText(details) : '';
    const detailBlock = details ? `\n\n${escapedDetails}` : '';
    const pluginNameText = escapeMarkdownText(payload.plugin_name);
    const pipelineBlock = currentPhase > phaseCount
        ? ''
        : `

# Pipeline Status
* ${phases[1]} **Phase 1: Validate approved submission**
* ${phases[2]} **Phase 2: Build plugin artifact**
* ${phases[3]} **Phase 3: Download compiled artifact**
* ${phases[4]} **Phase 4: Publish registry files**
* ${phases[5]} **Phase 5: Update GitHub release and stats**
* ${phases[6]} **Phase 6: Commit registry update**`;

    return `# Plugin Publish Status
**Plugin:** ${pluginNameText}
**Target:** [${targetText}](${targetUrl})
**Workflow Run:** [View Logs](${workflowRunUrl})${detailBlock}${pipelineBlock}`;
};

export const failureTemplate = (heading: string, message: string, runUrl: string): string => {
    const escapedMessage = escapeMarkdownText(message);
    const workflowRunUrl = escapeMarkdownUrl(runUrl);
    return `# ${heading}\n\n${escapedMessage}\n\n**Workflow Run:** [View Logs](${workflowRunUrl})`;
};
