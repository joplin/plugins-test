import { readFile, stat } from 'fs/promises';
import { relative, resolve, sep } from 'path';
import {
    extractReportMetadata,
    getPhases,
    renderFinalReport,
    statusTemplate,
} from './scanReport';
import type {
    GithubApiContext,
    GithubContext,
} from '../types/types';
import type { PluginManifest, PluginRegistry } from '../types/publishTypes';
import { runUrlFor, updateComment, failWithIssueComment, rejectWithIssueComment } from '../utils/github';
import { normalizeRepositoryUrl, parseGithubRepository, parseIssuePayload } from '../utils/payload';
import { fileExists, getRegistryPath, readJsonFromFile } from '../utils/utils';

const validateTitle = (title: string | null | undefined, pluginName: string, version: string) => {
    const expectedTitle = `[Plugin Submission] ${pluginName} v${version}`;

    if (title === expectedTitle) return '';

    return `Invalid issue title. Expected: ${expectedTitle}`;
};

export const repositorySubmissionManifestError = (manifest: unknown) => {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return 'The repository manifest must be a JSON object.';
    }

    const manifestRecord = manifest as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(manifestRecord, '_npm_package_name')) {
        return 'Repository submissions cannot include _npm_package_name in manifest.json.';
    }

    if (typeof manifestRecord.repository_url !== 'string' || !manifestRecord.repository_url.trim()) {
        return 'Repository submissions must specify repository_url in manifest.json.';
    }

    return '';
};

export const legacyRepositoryMigrationError = (
    pluginId: string,
    existingPlugin: Record<string, unknown>,
) => {
    const registeredUrl = existingPlugin.repository_url;
    const registeredNpmPackage = existingPlugin._npm_package_name;

    if (!registeredUrl && typeof registeredNpmPackage === 'string' && registeredNpmPackage.trim()) {
        return `Plugin "${pluginId}" has already been published from npm package "${registeredNpmPackage}". A maintainer must verify and register its repository URL before it can be published from a repository.`;
    }

    return '';
};

// checks if the plugin already exists in the manifest.json
const existingPluginFor = async (pluginId: string): Promise<PluginManifest | null> => {
    const manifestsPath = await getRegistryPath('manifests.json');

    if (!(await fileExists(manifestsPath))) return null;

    const manifests = await readJsonFromFile<PluginRegistry>(manifestsPath);

    return manifests[pluginId] ?? null;
};

const closeOwnershipMismatchIssue = async (
    { github, context, core }: GithubContext,
    commentId: number,
    pluginName: string,
    registeredUrl: string,
    repositoryUrl: string,
) => {
    const rejectMsg = `Security reject: plugin ${pluginName} already exists, but the repository URL does not match the registered owner.
Expected: ${registeredUrl}
Provided: ${repositoryUrl}`;

    await rejectWithIssueComment(
        { github, context, core },
        commentId,
        rejectMsg,
    );
};

const isInside = (parent: string, child: string) => {
    const relativePath = relative(parent, child);
    return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
};

// Created a comment in the issue body to indicate the scanning workflow has been started 
export const acknowledgeScanInitialization = async ({ github, context }: GithubApiContext) => {
    const body = `# Security Scan Initializing
Setting up the scanner and validating the submission payload.`;
    const comment = await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: body,
    });

    return comment.data.id;
};

export const initialize = async ({ github, context, core }: GithubContext) => {
    const validation = parseIssuePayload(context.payload.issue.body);
    const initialCommentId = process.env.INITIAL_COMMENT_ID;

    if (validation.ok === false) {
        return await failWithIssueComment(
            { github, context, core },
            initialCommentId,
            'Security Scan Failed',
            validation.error,
        );
    }

    const { plugin_name, version, repository_url, commit_hash } = validation.payload;
    const repository = parseGithubRepository(repository_url);

    if (!repository) {
        return await failWithIssueComment(
            { github, context, core },
            initialCommentId,
            'Security Scan Failed',
            `Validated repository URL could not be parsed: ${repository_url}`,
        );
    }

    const titleError = validateTitle(context.payload.issue.title, plugin_name, version);

    if (titleError) {
        return await rejectWithIssueComment(
            { github, context, core },
            initialCommentId,
            titleError,
        );
    }

    const runUrl = runUrlFor(context);
    const phases = getPhases(1);
    const commentBody = statusTemplate(repository_url, commit_hash, runUrl, phases);

    // Update or create the comment in the body 
    const comment = initialCommentId
        ? await github.rest.issues.updateComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            comment_id: parseInt(initialCommentId, 10),
            body: commentBody,
        })
        : await github.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.issue.number,
            body: commentBody,
        });

    const repoName = repository.repoName;

    core.setOutput('repository_url', repository_url);
    core.setOutput('version', version);
    core.setOutput('commit_hash', commit_hash);
    core.setOutput('repo_name', repoName);
    core.setOutput('comment_id', comment.data.id.toString());
    core.setOutput('should_proceed', 'true');
    core.setOutput('handled_failure', 'false');

    return {
        repository_url,
        version,
        commit_hash,
        repo_name: repoName,
        comment_id: comment.data.id,
        should_proceed: true,
    };
};

// Updates the emoji in the comment to show steps current state
export const updatePhase = async ({ github, context }: GithubApiContext, commentId: string, phase: number) => {
    const comment = await github.rest.issues.getComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: parseInt(commentId, 10),
    });
    const metadata = extractReportMetadata(comment.data.body);
    const phases = getPhases(phase);
    const newHeader = statusTemplate(metadata.repoUrl, metadata.commitHash, metadata.runUrl, phases, metadata.isUpdate);

    await updateComment(github, context, commentId, newHeader);
};

export const validateTargetRepository = async (
    { github, context, core }: GithubContext,
    commentId: string,
    targetPath: string,
) => {
    const workspace = process.env.GITHUB_WORKSPACE ? resolve(process.env.GITHUB_WORKSPACE) : resolve(process.cwd());
    const targetRoot = resolve(workspace, targetPath);

    const isDir = await stat(targetRoot).then(s => s.isDirectory()).catch(() => false);

    if (!isInside(workspace, targetRoot) || !isDir) {
        return await failWithIssueComment(
            { github, context, core },
            commentId,
            'Security Scan Failed',
            `Target repository path is invalid: ${targetPath}`,
        );
    }

    const parsePayloadResult = parseIssuePayload(context.payload.issue.body);
    if (parsePayloadResult.ok === false) {
        return await failWithIssueComment(
            { github, context, core },
            commentId,
            'Security Scan Failed',
            'Could not parse payload during target validation.',
        );
    }

    const { plugin_name, version, repository_url } = parsePayloadResult.payload;
    const packagePath = resolve(targetRoot, 'package.json');
    const manifestPath = resolve(targetRoot, 'src', 'manifest.json');
    let pkg: Record<string, any>;
    let manifest: Record<string, any>;

    if (await fileExists(packagePath)) {
        try {
            const packageContent = await readFile(packagePath, 'utf8');
            pkg = JSON.parse(packageContent);

            if (pkg.name !== plugin_name) {
                return await rejectWithIssueComment(
                    { github, context, core },
                    commentId,
                    `The plugin name in the issue payload (${plugin_name}) does not match the name in the repository's package.json (${pkg.name || 'unknown'}).`,
                );
            }
        } catch (e) {
            return await failWithIssueComment(
                { github, context, core },
                commentId,
                'Security Scan Failed',
                `Failed to parse package.json: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    } else {
        return await rejectWithIssueComment(
            { github, context, core },
            commentId,
            'Could not find package.json in the target repository root.',
        );
    }

    if (await fileExists(manifestPath)) {
        try {
            const manifestContent = await readFile(manifestPath, 'utf8');
            manifest = JSON.parse(manifestContent);

            const manifestError = repositorySubmissionManifestError(manifest);
            if (manifestError) {
                return await rejectWithIssueComment(
                    { github, context, core },
                    commentId,
                    manifestError,
                );
            }

            if (manifest.version !== version) {
                return await rejectWithIssueComment(
                    { github, context, core },
                    commentId,
                    `The plugin version in the issue payload (${version}) does not match the version in manifest.json (${manifest.version || 'unknown'}).`,
                );
            }

            const manifestRepo = manifest.repository_url;
            if (manifestRepo) {
                const rawManifestUrl = manifestRepo;
                const normalizedManifestUrl = normalizeRepositoryUrl(rawManifestUrl);
                const normalizedPayloadUrl = normalizeRepositoryUrl(repository_url);

                if (normalizedManifestUrl && normalizedPayloadUrl && normalizedManifestUrl !== normalizedPayloadUrl) {
                    return await rejectWithIssueComment(
                        { github, context, core },
                        commentId,
                        `The repository URL in the issue payload (${repository_url}) does not match the repository URL in the manifest.json (${rawManifestUrl}).`,
                    );
                }

                // Check ownership based on manifest.id and update comment body with Submission Type 
                const existingPlugin = await existingPluginFor(manifest.id);
                if (existingPlugin) {
                    const registeredUrl = existingPlugin.repository_url;
                    const migrationError = legacyRepositoryMigrationError(manifest.id, existingPlugin);

                    if (migrationError) {
                        return await rejectWithIssueComment(
                            { github, context, core },
                            commentId,
                            migrationError,
                        );
                    }

                    if (registeredUrl && normalizeRepositoryUrl(registeredUrl) !== normalizeRepositoryUrl(repository_url)) {
                        await closeOwnershipMismatchIssue(
                            { github, context, core },
                            parseInt(commentId, 10),
                            pkg.name,
                            registeredUrl,
                            repository_url,
                        );
                        return { handled_failure: true };
                    }

                    const newVersion = manifest.version || '0.0.0';
                    const oldVersion = existingPlugin.version || '0.0.0';

                    const parseVersion = (v: string) => v.split('.').map(x => parseInt(x, 10) || 0);
                    const newParts = parseVersion(newVersion);
                    const oldParts = parseVersion(oldVersion);

                    let isGreater = false;
                    const maxLen = Math.max(newParts.length, oldParts.length);
                    for (let i = 0; i < maxLen; i++) {
                        const n = newParts[i] || 0;
                        const o = oldParts[i] || 0;
                        if (n !== o) {
                            isGreater = n > o;
                            break;
                        }
                    }

                    if (!isGreater) {
                        return await rejectWithIssueComment(
                            { github, context, core },
                            commentId,
                            `This is an update job, but the plugin version in the manifest (${newVersion}) is not greater than the currently published version (${oldVersion}). Please bump the version number before submitting.`,
                        );
                    }
                }

                // Append the isUpdate flag to the comment body for the reviewer
                const isUpdate = !!existingPlugin;
                const comment = await github.rest.issues.getComment({ owner: context.repo.owner, repo: context.repo.repo, comment_id: parseInt(commentId, 10) });
                const metadata = extractReportMetadata(comment.data.body);
                metadata.isUpdate = isUpdate;

                // This function runs after Phase 2
                const newHeader = statusTemplate(metadata.repoUrl, metadata.commitHash, metadata.runUrl, getPhases(2), metadata.isUpdate);
                await updateComment(github, context, commentId, newHeader);

            }
        } catch (e) {
            return await failWithIssueComment(
                { github, context, core },
                commentId,
                'Security Scan Failed',
                `Failed to parse manifest.json: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    } else {
        return await rejectWithIssueComment(
            { github, context, core },
            commentId,
            'Could not find src/manifest.json in the target repository. Submissions must follow the generator-joplin structure (src/manifest.json).',
        );
    }

    core.setOutput('handled_failure', 'false');

    return { handled_failure: false };
};

export const generateFinalReport = async (
    { github, context, core }: GithubContext,
    commentId: string,
    sarifPath: string,
    repoUrl: string,
    commitHash: string,
    analysisOutcome: string,
) => {
    const comment = await github.rest.issues.getComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: parseInt(commentId, 10),
    });
    const metadata = extractReportMetadata(comment.data.body);

    const report = await renderFinalReport({
        sarifPath,
        repoUrl,
        commitHash,
        runUrl: runUrlFor(context),
        analysisOutcome,
        isUpdate: metadata.isUpdate,
    });

    await updateComment(github, context, commentId, report.body);
    core.setOutput('handled_failure', (!report.ok).toString());

    if (!report.ok) {
        core.setFailed(report.error ?? 'The security scan did not complete successfully.');
    }

    return { handled_failure: !report.ok };
};
