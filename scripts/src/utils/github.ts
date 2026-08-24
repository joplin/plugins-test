import type {
    GithubActionContext,
    GithubClient,
    GithubContext,
    GithubIssueCommentResponse,
    WorkflowFailureResult,
} from '../types/types';

export const runUrlFor = (context: GithubActionContext): string => {
    const serverUrl = (context.serverUrl ?? 'https://github.com').replace(/\/+$/, '');
    return `${serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
};

const commentIdNumber = (commentId: string | number): number => {
    const id = typeof commentId === 'number' ? commentId : Number(commentId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid issue comment id: ${commentId}`);
    return id;
};

export const updateComment = async (github: GithubClient, context: GithubActionContext, commentId: string | number, body: string): Promise<void> => {
    const id = commentIdNumber(commentId);
    await github.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: id,
        body,
    });
};

const createComment = async (github: GithubClient, context: GithubActionContext, body: string): Promise<GithubIssueCommentResponse> => {
    return github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body,
    });
};

export const failWithIssueComment = async (
    { github, context, core }: GithubContext,
    commentId: string | number | undefined,
    heading: string,
    message: string,
): Promise<WorkflowFailureResult> => {
    const runUrl = runUrlFor(context);
    const body = `# ${heading}\n${message}\n**Workflow Run:** [View Logs](${runUrl})`;

    if (commentId !== undefined) {
        await updateComment(github, context, commentId, body);
    } else {
        await createComment(github, context, body);
    }

    core.setOutput('handled_failure', 'true');
    core.setFailed(message);

    return { should_proceed: false };
};

export const rejectWithIssueComment = async (
    githubContext: GithubContext,
    commentId: string | number | undefined,
    message: string,
): Promise<WorkflowFailureResult> => {
    const result = await failWithIssueComment(
        githubContext,
        commentId,
        'Security Scan Rejected',
        message,
    );

    const { github, context } = githubContext;
    await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        state: 'closed',
        state_reason: 'not_planned',
    });

    return result;
};
