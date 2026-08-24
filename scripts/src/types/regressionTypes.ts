export interface Finding {
    plugin: string;
    ruleId: string;
    file: string;
    line: string;
}

export interface RegressionSarifLocation {
    physicalLocation?: {
        artifactLocation?: {
            uri?: string;
        };
        region?: {
            startLine?: number;
        };
    };
}

export interface RegressionSarifResult {
    ruleId?: string;
    rule?: {
        id?: string;
    };
    locations?: RegressionSarifLocation[];
}

export interface RegressionSarifReport {
    runs?: Array<{
        results?: RegressionSarifResult[];
    }>;
}
