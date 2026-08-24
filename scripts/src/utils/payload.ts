import type { GithubRepository, SubmissionPayload, ValidationResult } from '../types/types';

export const parseGithubRepository = (repositoryUrl: string): GithubRepository | null => {
    const match = repositoryUrl.trim().match(
        /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/,
    );

    if (!match) return null;

    const owner = match[1];
    const repo = match[2];

    return {
        canonicalUrl: `https://github.com/${owner}/${repo}`,
        repoName: `${owner}/${repo}`,
    };
};

const canonicalRepositoryUrl = (repositoryUrl: string): string => {
    const repository = parseGithubRepository(repositoryUrl);
    return repository ? repository.canonicalUrl : repositoryUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
};

export const normalizeRepositoryUrl = (repositoryUrl: string): string => {
    return canonicalRepositoryUrl(repositoryUrl).toLowerCase();
};

const pluginVersionPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;
const payloadFields = ['plugin_name', 'version', 'repository_url', 'commit_hash'] as const;

export const parseIssuePayload = (body: string | null | undefined): ValidationResult => {
    const jsonMatch = (body ?? '').match(/```json\s*([\s\S]*?)\s*```/);

    if (!jsonMatch) {
        return {
            ok: false,
            error: 'Could not find a JSON payload in the issue body. Include a ```json block.',
        };
    }

    let payload: Record<string, unknown>;

    try {
        const parsedPayload: unknown = JSON.parse(jsonMatch[1]);

        if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
            return {
                ok: false,
                error: 'Invalid JSON payload. The JSON block must contain an object.',
            };
        }

        payload = parsedPayload as Record<string, unknown>;
    } catch {
        return {
            ok: false,
            error: 'Invalid JSON payload. Check the JSON block for syntax errors.',
        };
    }

    const missingFields = payloadFields.filter(field => !Object.prototype.hasOwnProperty.call(payload, field));

    if (missingFields.length > 0) {
        return {
            ok: false,
            error: 'Missing required fields. Provide `plugin_name`, `version`, `repository_url`, and `commit_hash`',
        };
    }

    const unexpectedFields = Object.keys(payload).filter(field => !(payloadFields as readonly string[]).includes(field));
    if (unexpectedFields.length > 0) {
        return {
            ok: false,
            error: `Unexpected payload fields: ${unexpectedFields.join(', ')}.`,
        };
    }

    const { plugin_name, version, repository_url, commit_hash } = payload;

    if (
        typeof plugin_name !== 'string'
        || typeof version !== 'string'
        || typeof repository_url !== 'string'
        || typeof commit_hash !== 'string'
    ) {
        return {
            ok: false,
            error: 'Invalid payload field types. plugin_name, version, repository_url, and commit_hash must be strings.',
        };
    }

    const normalizedPluginName = plugin_name.trim();
    const normalizedVersion = version.trim();

    if (!normalizedPluginName) {
        return {
            ok: false,
            error: 'Invalid plugin_name. It must be a non-empty string.',
        };
    }

    if (!pluginVersionPattern.test(normalizedVersion)) {
        return {
            ok: false,
            error: `Invalid plugin version: ${version}. It must follow semantic version format (for example, 1.2.3).`,
        };
    }

    const repository = parseGithubRepository(repository_url);

    if (!repository) {
        return {
            ok: false,
            error: `Invalid repository URL: ${repository_url}. It must be a GitHub repository URL.`,
        };
    }

    if (!/^[a-fA-F0-9]{40}$/.test(commit_hash)) {
        return {
            ok: false,
            error: `Invalid commit hash: ${commit_hash}.`,
        };
    }

    return {
        ok: true,
        payload: {
            plugin_name: normalizedPluginName,
            version: normalizedVersion,
            repository_url: repository.canonicalUrl,
            commit_hash: commit_hash.toLowerCase(),
        },
    };
};
