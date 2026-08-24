import { join } from 'path';
import { readFile } from 'fs/promises';
import type { GithubApiContext, GithubContext, GithubCoreContext } from '../types/types';
import type { PluginManifest, PluginRegistry, PublishSummary } from '../types/publishTypes';
import { runUrlFor, updateComment } from '../utils/github';
import { normalizeRepositoryUrl } from '../utils/payload';
import { statusTemplate, failureTemplate } from './publishTemplates';
import { parsePayloadFromContext, parseSummary, commitHashFromPublishCommit, parseBoolean, toPublishPayload } from './validationUtils';
import { parseIssuePayload } from '../utils/payload';
import { hasCompletedScanReport } from './scanUtils';
import { fileExists, readJsonFromFile, writeJsonFile, sha256File, escapeMarkdownUrl, escapeMarkdownText, escapeInlineCode } from '../utils/utils';

export const acknowledgePublishInitialization = async ({ github, context, core }: GithubContext) => {
    const runUrl = runUrlFor(context);
    const escapedRunUrl = escapeMarkdownUrl(runUrl);
    const initialBody = `# Plugin Publish Status\nValidating the approved submission.\n\n**Workflow Run:** [View Logs](${escapedRunUrl})`;
    const initialCommentId = process.env.INITIAL_COMMENT_ID;

    const commentId = initialCommentId
        ? initialCommentId
        : (await github.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.issue.number,
            body: initialBody,
        })).data.id.toString();

    if (initialCommentId) {
        await updateComment(github, context, initialCommentId, initialBody);
    }

    core.setOutput('comment_id', commentId.toString());

    const validation = parseIssuePayload(context.payload.issue.body);

    if (validation.ok === false) {
        const template = failureTemplate('Plugin Publish Rejected', validation.error ?? '', runUrl);
        await updateComment(github, context, commentId, template);

        core.setOutput('should_proceed', 'false');
        core.setFailed(validation.error ?? '');

        return { should_proceed: false, comment_id: commentId.toString() };
    }

    const payload = toPublishPayload(validation.payload);

    if (!(await hasCompletedScanReport({ github, context }, payload))) {
        const scanError = 'No completed security scan report was found for this exact repository URL and commit hash. Re-run the scan before approving this submission.';
        const template = failureTemplate('Plugin Publish Rejected', scanError, runUrl);
        await updateComment(github, context, commentId, template);

        core.setOutput('should_proceed', 'false');
        core.setFailed(scanError);

        return { should_proceed: false, comment_id: commentId.toString() };
    }

    const template = statusTemplate(payload, runUrl, 2, 'Approved submission validated. The untrusted build job is starting.');
    await updateComment(github, context, commentId, template);

    core.setOutput('plugin_name', payload.plugin_name);
    core.setOutput('version', payload.version);
    core.setOutput('repository_url', payload.repository_url);
    core.setOutput('repo_name', payload.repo_name);
    core.setOutput('commit_hash', payload.commit_hash);
    core.setOutput('comment_id', commentId.toString());
    core.setOutput('should_proceed', 'true');

    return {
        plugin_name: payload.plugin_name,
        version: payload.version,
        repository_url: payload.repository_url,
        repo_name: payload.repo_name,
        commit_hash: payload.commit_hash,
        comment_id: commentId.toString(),
        should_proceed: true,
    };
};

export const updatePublishPhase = async (
    { github, context }: GithubApiContext,
    commentId: string | number,
    phase: number,
    details?: string,
) => {
    const payload = parsePayloadFromContext(context);
    const runUrl = runUrlFor(context);
    const body = payload
        ? statusTemplate(payload, runUrl, phase, details)
        : failureTemplate('Plugin Publish Status', details ?? 'Publish workflow is running.', runUrl);

    await updateComment(github, context, commentId, body);
};

export const markPublishedPluginApproved = async (repoDir: string, artifactManifestFile: string) => {
    const artifactManifest = await readJsonFromFile<PluginManifest>(artifactManifestFile);
    const pluginId = artifactManifest.id;

    if (!pluginId) {
        throw new Error('Artifact manifest is missing id.');
    }

    const registryManifestFile = join(repoDir, 'plugins', pluginId, 'manifest.json');
    const manifestsFile = join(repoDir, 'manifests.json');
    const registryManifest = await readJsonFromFile<PluginManifest>(registryManifestFile);
    const manifests = await readJsonFromFile<PluginRegistry>(manifestsFile);

    registryManifest._approved = true;

    if (!manifests[pluginId]) {
        throw new Error(`manifests.json does not contain ${pluginId}.`);
    }

    manifests[pluginId]._approved = true;

    await writeJsonFile(registryManifestFile, registryManifest);
    await writeJsonFile(manifestsFile, manifests);

    return { plugin_id: pluginId };
};

export const verifyPublishedRegistry = async (
    { core }: GithubCoreContext,
    repoDir: string,
    artifactManifestFile: string,
    artifactJplFile: string,
    expectedVersion: string,
    expectedRepositoryUrl: string,
    expectedCommitHash: string,
) => {
    const artifactManifest = await readJsonFromFile<PluginManifest>(artifactManifestFile);
    const pluginId = artifactManifest.id;
    const pluginVersion = artifactManifest.version;

    if (!pluginId || !pluginVersion) {
        throw new Error('Artifact manifest is missing id or version.');
    }

    if (pluginVersion !== expectedVersion) {
        throw new Error(`Artifact version ${pluginVersion} does not match the approved issue payload version ${expectedVersion} for ${pluginId}.`);
    }

    const artifactUrl = normalizeRepositoryUrl(artifactManifest.repository_url);
    const expectedUrl = normalizeRepositoryUrl(expectedRepositoryUrl);

    if (artifactUrl !== expectedUrl) {
        throw new Error(`Artifact repository_url does not match the approved issue payload for ${pluginId}.`);
    }

    const publishedCommitHash = commitHashFromPublishCommit(artifactManifest._publish_commit);
    if (publishedCommitHash.toLowerCase() !== expectedCommitHash.toLowerCase()) {
        throw new Error(`Artifact _publish_commit does not match the approved commit for ${pluginId}.`);
    }

    const artifactHash = await sha256File(artifactJplFile);
    if (artifactManifest._publish_hash !== artifactHash) {
        throw new Error(`Artifact _publish_hash does not match the compiled JPL bytes for ${pluginId}.`);
    }

    const registryManifestFile = join(repoDir, 'plugins', pluginId, 'manifest.json');
    const registryJplFile = join(repoDir, 'plugins', pluginId, 'plugin.jpl');
    const manifestsFile = join(repoDir, 'manifests.json');

    if (!(await fileExists(registryManifestFile))) {
        throw new Error(`Published registry manifest is missing: plugins/${pluginId}/manifest.json`);
    }

    if (!(await fileExists(registryJplFile))) {
        throw new Error(`Published plugin archive is missing: plugins/${pluginId}/plugin.jpl`);
    }

    const registryManifest = await readJsonFromFile<PluginManifest>(registryManifestFile);
    if (registryManifest.id !== pluginId || registryManifest.version !== pluginVersion) {
        throw new Error(`Published registry manifest does not match artifact identity for ${pluginId}.`);
    }

    if (registryManifest._approved !== true) {
        throw new Error(`Published registry manifest for ${pluginId} is missing _approved: true.`);
    }

    if (registryManifest._publish_hash !== artifactHash) {
        throw new Error(`Published registry manifest hash does not match the compiled JPL bytes for ${pluginId}.`);
    }

    const registryUrl = normalizeRepositoryUrl(registryManifest.repository_url);
    if (registryUrl !== expectedUrl) {
        throw new Error(`Published registry manifest repository_url does not match the approved issue payload for ${pluginId}.`);
    }

    const manifests = await readJsonFromFile<PluginRegistry>(manifestsFile);
    if (!manifests[pluginId]) {
        throw new Error(`manifests.json does not contain ${pluginId}.`);
    }

    if (manifests[pluginId]._approved !== true) {
        throw new Error(`manifests.json entry for ${pluginId} is missing _approved: true.`);
    }

    core.setOutput('plugin_id', pluginId);
    core.setOutput('plugin_version', pluginVersion);

    return { plugin_id: pluginId, plugin_version: pluginVersion };
};

export const summarizePublishResult = async (
    { core }: GithubCoreContext,
    repoDir: string,
    manifestFile: string,
    releaseLogPath: string,
    readmeUpdated: string,
    statsUpdated: string,
) => {
    const manifest = await readJsonFromFile<PluginManifest>(manifestFile);

    if (!manifest.id || !manifest.version) {
        throw new Error('Published manifest is missing id or version.');
    }
    const pluginDirectory = join(repoDir, 'plugins', manifest.id);
    const pluginJplPath = join(pluginDirectory, 'plugin.jpl');
    const pluginManifestPath = join(pluginDirectory, 'manifest.json');
    let releaseLog = '';

    if (await fileExists(releaseLogPath)) {
        releaseLog = await readFile(releaseLogPath, 'utf8');
    }

    const releaseUpdated = /\b(Uploading|Deleting old asset)\b/.test(releaseLog);

    const isReadmeUpdated = parseBoolean(readmeUpdated);
    const isStatsUpdated = parseBoolean(statsUpdated);
    const registryUpdated = (await fileExists(pluginJplPath)) && (await fileExists(pluginManifestPath));

    const summary: PublishSummary = {
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        pluginDirectory: `plugins/${manifest.id}`,
        registryUpdated,
        readmeUpdated: isReadmeUpdated,
        statsUpdated: isStatsUpdated || /Updating stats file/.test(releaseLog),
        releaseUpdated,
    };

    core.setOutput('summary', JSON.stringify(summary));
    return summary;
};

export const finishPublish = async (
    { github, context }: GithubApiContext,
    commentId: string | number,
    summaryJson?: string | PublishSummary,
) => {
    const payload = parsePayloadFromContext(context);
    const summary = parseSummary(summaryJson);
    const pluginLabel = summary.pluginId && summary.pluginVersion
        ? `${summary.pluginId}@${summary.pluginVersion}`
        : payload?.plugin_name ?? 'the plugin';
    const pluginDirectory = summary.pluginDirectory ?? (summary.pluginId ? `plugins/${summary.pluginId}` : 'plugins/');
    const runUrl = runUrlFor(context);

    const escapedLabel = escapeMarkdownText(pluginLabel);
    const escapedDir = escapeInlineCode(pluginDirectory);

    const registryStatus = summary.registryUpdated ? 'updated' : 'not verified';
    const readmeStatus = summary.readmeUpdated ? 'updated' : 'no file change detected';
    const releaseStatus = summary.releaseUpdated ? 'updated' : 'no asset change detected';
    const statsStatus = summary.statsUpdated ? 'updated' : 'no file change detected';

    const details = `The plugin **${escapedLabel}** has been added to the registry.

* Registry folder: \`${escapedDir}\` ${registryStatus}
* README.md: ${readmeStatus}
* GitHub release assets: ${releaseStatus}
* stats.json: ${statsStatus}`;

    const escapedUrl = escapeMarkdownUrl(runUrl);
    const body = payload
        ? statusTemplate(payload, runUrl, 7, details)
        : `# Plugin Published Successfully\n\n${details}\n\n**Workflow Run:** [View Logs](${escapedUrl})`;

    await updateComment(github, context, commentId, body);

    await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        state: 'closed',
        state_reason: 'completed',
    });
};

export const handleWorkflowFailure = async (
    { github, context }: GithubApiContext,
    commentId: string | number | undefined,
    message = 'The publish workflow encountered an error. Check the workflow logs for details.',
) => {
    const runUrl = runUrlFor(context);
    const body = failureTemplate('Plugin Publish Failed', message, runUrl);

    if (commentId !== undefined) {
        await updateComment(github, context, commentId, body);
        return;
    }

    await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body,
    });
};

export const cliPublishFailureReason = (log: string) => {
    const errorMatch = log.match(/(?:^|\n)Error:\s*([^\r\n]+)/);
    const fallback = log.trim().split(/\r?\n/).slice(-3).join(' ');
    return (errorMatch?.[1] || fallback || 'The publish CLI rejected the plugin.').slice(0, 1000);
};

export const reportCliPublishFailure = async (
    { github, context, core }: GithubContext,
    commentId: string | number | undefined,
    logPath: string,
) => {
    const log = await readFile(logPath, 'utf8');
    const reason = cliPublishFailureReason(log);
    const message = `The plugin was rejected by plugin-repo-cli: ${reason}`;

    await handleWorkflowFailure({ github, context }, commentId, message);
    core.setFailed(message);

    return { reason };
};
