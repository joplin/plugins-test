export type GithubClient = any;
export type GithubActionContext = any;
export type GithubActionCore = any;

export interface GithubApiContext {
    github: GithubClient;
    context: GithubActionContext;
}

export interface GithubCoreContext {
    core: GithubActionCore;
}

export interface GithubContext extends GithubApiContext, GithubCoreContext {}

export interface SubmissionPayload {
    plugin_name: string;
    version: string;
    repository_url: string;
    commit_hash: string;
}

export interface ValidationSuccess {
    ok: true;
    payload: SubmissionPayload;
}

export interface ValidationFailure {
    ok: false;
    error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export type PhaseMap = Record<number, string>;

export interface ReportMetadata {
    repoUrl: string;
    commitHash: string;
    runUrl: string;
    isUpdate?: boolean;
}

export interface FinalReportInput {
    sarifPath: string;
    repoUrl: string;
    commitHash: string;
    runUrl: string;
    analysisOutcome: string;
    isUpdate?: boolean;
}

export interface FinalReportResult {
    ok: boolean;
    body: string;
    error?: string;
}

export interface SarifMessage {
    text?: string;
}

export interface SarifArtifactLocation {
    uri?: string;
}

export interface SarifRegion {
    startLine?: number;
}

export interface SarifPhysicalLocation {
    artifactLocation?: SarifArtifactLocation;
    region?: SarifRegion;
}

export interface SarifLocation {
    physicalLocation?: SarifPhysicalLocation;
}

export interface SarifResult {
    ruleId: string;
    message?: SarifMessage;
    locations?: SarifLocation[];
}

export interface SarifRuleDescription {
    text?: string;
}

export interface SarifRuleConfiguration {
    level?: string;
}

export interface SarifRule {
    id: string;
    name?: string;
    shortDescription?: SarifRuleDescription;
    defaultConfiguration?: SarifRuleConfiguration;
    properties?: Record<string, any>;
}

export interface SarifDriver {
    rules?: SarifRule[];
}

export interface SarifExtension {
    rules?: SarifRule[];
}

export interface SarifTool {
    driver?: SarifDriver;
    extensions?: SarifExtension[];
}

export interface SarifRun {
    results?: SarifResult[];
    tool?: SarifTool;
}

export interface SarifReport {
    runs: SarifRun[];
}
