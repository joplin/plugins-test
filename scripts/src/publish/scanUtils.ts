import type { GithubApiContext } from '../types/types';
import type { PublishPayload } from '../types/publishTypes';
import { normalizeRepositoryUrl } from '../utils/payload';

export const scanReportMatchesPayload = (body: string, payload: PublishPayload) => {
    if (!body.includes('# Security Scan Report') || !body.includes('# Findings')) return false;
    if (body.includes('Failed to generate a SARIF report') || body.includes('# Security Scan Failed')) return false;

    const targetUrlMatch = body.match(/\*\*Target:\*\* \[[^\]]+\]\(([^)]+)\)/);
    const targetUrl = targetUrlMatch?.[1] ?? '';
    const targetMatch = targetUrl.match(/^(.*)\/(?:tree|commit)\/([a-fA-F0-9]{40})(?:[)#?].*)?$/);

    if (!targetMatch) return false;

    const scannedRepoUrl = targetMatch[1];
    const scannedCommitHash = targetMatch[2].toLowerCase();

    const normalizedScannedUrl = normalizeRepositoryUrl(scannedRepoUrl);
    const normalizedPayloadUrl = normalizeRepositoryUrl(payload.repository_url);

    return normalizedScannedUrl === normalizedPayloadUrl
        && scannedCommitHash === payload.commit_hash.toLowerCase();
};

export const hasCompletedScanReport = async ({ github, context }: GithubApiContext, payload: PublishPayload) => {
    const comments = await github.paginate(github.rest.issues.listComments, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        per_page: 100,
    });

    for (const comment of comments) {
        if (scanReportMatchesPayload(comment.body ?? '', payload)) {
            return true;
        }
    }

    return false;
};
