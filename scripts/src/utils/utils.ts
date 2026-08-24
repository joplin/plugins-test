import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { PhaseMap } from '../types/types';

export const requiredEnvironmentValue = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    return value;
};

export const toRepoRelativeFile = (uri: string | undefined) => {
    if (!uri) return 'unknown file';

    let normalized = uri;
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // Keep the original URI when it contains malformed escape sequences.
    }

    normalized = normalized
        .replace(/^file:\/\//, '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

    const targetPluginMarker = 'target-plugin/';
    const targetPluginIndex = normalized.lastIndexOf(targetPluginMarker);
    if (targetPluginIndex >= 0) return normalized.slice(targetPluginIndex + targetPluginMarker.length);

    return normalized || basename(uri);
};

export const fileExists = async (path: string) => {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
};

export const getRegistryPath = async (relativePath: string) => {
    const workspace = process.env.GITHUB_WORKSPACE;
    const candidates = [
        workspace ? resolve(workspace, 'plugins-test', relativePath) : '',
        resolve(process.cwd(), 'plugins-test', relativePath),
        resolve(process.cwd(), relativePath),
        resolve(__dirname, '..', '..', relativePath),
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (await fileExists(candidate)) return candidate;
    }

    return candidates[0];
};

export const readJsonFromFile = async <T>(path: string): Promise<T> => {
    return JSON.parse(await readFile(path, 'utf8')) as T;
};

export const writeJsonFile = async (path: string, value: unknown) => {
    await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`, 'utf8');
};

export const sha256File = async (path: string) => {
    const hash = createHash('sha256');
    hash.update(await readFile(path));
    return `sha256:${hash.digest('hex')}`;
};

export const buildPhaseMap = (currentPhase: number, phaseCount: number) => {
    const phases: PhaseMap = {};

    for (let phase = 1; phase <= phaseCount; phase++) {
        if (currentPhase > phaseCount || phase < currentPhase) {
            phases[phase] = '✅';
        } else if (phase === currentPhase) {
            phases[phase] = '⏳';
        } else {
            phases[phase] = '⚪';
        }
    }

    return phases;
};

export const escapeMarkdownText = (value: string) => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

export const escapeInlineCode = (value: string) => {
    return value.replace(/`/g, '\\`');
};

export const escapeMarkdownUrl = (value: string) => {
    return value.replace(/\(/g, '%28').replace(/\)/g, '%29');
};
