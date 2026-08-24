import type { GithubActionContext, SubmissionPayload } from '../types/types';
import type { PublishPayload, PublishSummary } from '../types/publishTypes';
import { parseGithubRepository, parseIssuePayload } from '../utils/payload';

export const toPublishPayload = (payload: SubmissionPayload): PublishPayload => {
    const repository = parseGithubRepository(payload.repository_url);
    if (!repository) throw new Error(`Invalid repository URL: ${payload.repository_url}`);

    return {
        ...payload,
        repository_url: repository.canonicalUrl,
        repo_name: repository.repoName,
    };
};

export const parsePayloadFromContext = (context: GithubActionContext): PublishPayload | null => {
    const validation = parseIssuePayload(context.payload.issue.body);
    if (validation.ok === false) return null;
    return toPublishPayload(validation.payload);
};

export const parseBoolean = (value: unknown) => {
    return value === true || value === 'true' || value === '1';
};

export const parseSummary = (summaryJson: string | PublishSummary | null | undefined): PublishSummary => {
    if (!summaryJson) return {};
    if (typeof summaryJson !== 'string') return summaryJson;

    try {
        return JSON.parse(summaryJson) as PublishSummary;
    } catch {
        return {};
    }
};

export const commitHashFromPublishCommit = (publishCommit: unknown) => {
    if (typeof publishCommit !== 'string') return '';
    return publishCommit.includes(':') ? (publishCommit.split(':').pop() ?? '') : publishCommit;
};
