import type { SubmissionPayload } from './types';

export interface PublishPayload extends SubmissionPayload {
    repo_name: string;
}

export interface PublishSummary {
    pluginId?: string;
    pluginVersion?: string;
    pluginDirectory?: string;
    registryUpdated?: boolean;
    readmeUpdated?: boolean;
    statsUpdated?: boolean;
    releaseUpdated?: boolean;
}

export interface PluginManifest {
    id?: string;
    version?: string;
    name?: string;
    repository_url?: string;
    _npm_package_name?: string;
    _approved?: boolean;
    _publish_hash?: string;
    _publish_commit?: unknown;
    [key: string]: unknown;
}

export type PluginRegistry = Record<string, PluginManifest>;
