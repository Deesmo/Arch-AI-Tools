export declare function validateData(payload: any): {
    ok: boolean;
    error: string;
    errors?: undefined;
} | {
    ok: boolean;
    errors: import("ajv").ErrorObject<string, Record<string, any>, unknown>[];
    error?: undefined;
};
export declare function generateHash(payload: any): {
    ok: boolean;
    error: string;
    supported: string[];
    algorithm?: undefined;
    hash?: undefined;
} | {
    ok: boolean;
    algorithm: any;
    hash: string;
    error?: undefined;
    supported?: undefined;
};
export declare function qrCode(payload: any): Promise<{
    ok: boolean;
    error: string;
    max?: undefined;
    format?: undefined;
    data?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    format?: undefined;
    data?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    format: string;
    data: string;
    error?: undefined;
    max?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    max?: undefined;
    format?: undefined;
    data?: undefined;
}>;
export declare function convertFormat(payload: any): Promise<{
    ok: boolean;
    error: string;
    supported: string[];
    from?: undefined;
    to?: undefined;
    data?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    from: any;
    to: any;
    data: string;
    error?: undefined;
    supported?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    supported?: undefined;
    from?: undefined;
    to?: undefined;
    data?: undefined;
}>;
export declare function transformText(payload: any): Promise<{
    ok: boolean;
    error: string;
    supported: string[];
    mode?: undefined;
    result?: undefined;
} | {
    ok: boolean;
    mode: any;
    result: string | number | object;
    error?: undefined;
    supported?: undefined;
}>;
export declare function extractMetadata(payload: any): Promise<{
    ok: boolean;
    source: string;
    url: string;
    status: number;
    content_type: string;
    content_length: number | null;
    last_modified: string | null;
    server: string | null;
    title: string;
    description: string;
    og_image: string;
    canonical: string;
    error?: undefined;
    detail?: undefined;
    length?: undefined;
    bytes?: undefined;
    lines?: undefined;
    words?: undefined;
    sentences?: undefined;
    avg_word_length?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    source?: undefined;
    url?: undefined;
    status?: undefined;
    content_type?: undefined;
    content_length?: undefined;
    last_modified?: undefined;
    server?: undefined;
    title?: undefined;
    description?: undefined;
    og_image?: undefined;
    canonical?: undefined;
    length?: undefined;
    bytes?: undefined;
    lines?: undefined;
    words?: undefined;
    sentences?: undefined;
    avg_word_length?: undefined;
} | {
    ok: boolean;
    source: string;
    length: number;
    bytes: number;
    lines: number;
    words: number;
    sentences: number;
    avg_word_length: number;
    url?: undefined;
    status?: undefined;
    content_type?: undefined;
    content_length?: undefined;
    last_modified?: undefined;
    server?: undefined;
    title?: undefined;
    description?: undefined;
    og_image?: undefined;
    canonical?: undefined;
    error?: undefined;
    detail?: undefined;
}>;
export declare function webScrape(payload: any): Promise<{
    ok: boolean;
    error: string;
    max: number;
    status?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    content?: undefined;
    length?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    max?: undefined;
    status?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    content?: undefined;
    length?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    max?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    content?: undefined;
    length?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    content_type: string;
    max?: undefined;
    status?: undefined;
    url?: undefined;
    title?: undefined;
    content?: undefined;
    length?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    url: string;
    title: string;
    content: string;
    length: number;
    truncated: boolean;
    error?: undefined;
    max?: undefined;
    status?: undefined;
    content_type?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    max?: undefined;
    status?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    content?: undefined;
    length?: undefined;
    truncated?: undefined;
}>;
export declare function aiGenerate(payload: any): Promise<{
    ok: boolean;
    error: string;
    max?: undefined;
    allowed?: undefined;
    status?: undefined;
    detail?: undefined;
    model?: undefined;
    text?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    allowed?: undefined;
    status?: undefined;
    detail?: undefined;
    model?: undefined;
    text?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    error: string;
    allowed: string[];
    max?: undefined;
    status?: undefined;
    detail?: undefined;
    model?: undefined;
    text?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    detail: any;
    max?: undefined;
    allowed?: undefined;
    model?: undefined;
    text?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    model: any;
    text: any;
    usage: any;
    error?: undefined;
    max?: undefined;
    allowed?: undefined;
    status?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    max?: undefined;
    allowed?: undefined;
    status?: undefined;
    model?: undefined;
    text?: undefined;
    usage?: undefined;
}>;
export declare function ocrExtract(payload: any): Promise<{
    ok: boolean;
    error: string;
    status?: undefined;
    detail?: undefined;
    text?: undefined;
    char_count?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    detail?: undefined;
    text?: undefined;
    char_count?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    status?: undefined;
    text?: undefined;
    char_count?: undefined;
    usage?: undefined;
} | {
    ok: boolean;
    text: any;
    char_count: any;
    usage: any;
    error?: undefined;
    status?: undefined;
    detail?: undefined;
}>;
export declare function ipLookup(payload: any): Promise<{
    ok: boolean;
    error: string;
    detail?: undefined;
    ip?: undefined;
    country?: undefined;
    country_code?: undefined;
    region?: undefined;
    region_code?: undefined;
    city?: undefined;
    zip?: undefined;
    lat?: undefined;
    lon?: undefined;
    timezone?: undefined;
    isp?: undefined;
    org?: undefined;
    asn?: undefined;
    is_mobile?: undefined;
    is_proxy?: undefined;
    is_hosting?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    ip?: undefined;
    country?: undefined;
    country_code?: undefined;
    region?: undefined;
    region_code?: undefined;
    city?: undefined;
    zip?: undefined;
    lat?: undefined;
    lon?: undefined;
    timezone?: undefined;
    isp?: undefined;
    org?: undefined;
    asn?: undefined;
    is_mobile?: undefined;
    is_proxy?: undefined;
    is_hosting?: undefined;
} | {
    ok: boolean;
    ip: any;
    country: any;
    country_code: any;
    region: any;
    region_code: any;
    city: any;
    zip: any;
    lat: any;
    lon: any;
    timezone: any;
    isp: any;
    org: any;
    asn: any;
    is_mobile: any;
    is_proxy: any;
    is_hosting: any;
    error?: undefined;
    detail?: undefined;
}>;
export declare function emailVerify(payload: any): Promise<{
    ok: boolean;
    error: string;
    valid?: undefined;
    reason?: undefined;
    email?: undefined;
    syntax_valid?: undefined;
    has_mx?: undefined;
    mx_records?: undefined;
    is_disposable?: undefined;
    domain?: undefined;
} | {
    ok: boolean;
    valid: boolean;
    reason: string;
    email: string;
    error?: undefined;
    syntax_valid?: undefined;
    has_mx?: undefined;
    mx_records?: undefined;
    is_disposable?: undefined;
    domain?: undefined;
} | {
    ok: boolean;
    email: string;
    valid: boolean;
    reason: string | null;
    syntax_valid: boolean;
    has_mx: boolean;
    mx_records: string[];
    is_disposable: boolean;
    domain: string;
    error?: undefined;
}>;
export declare function phoneValidate(payload: any): Promise<{
    ok: boolean;
    error: string;
    valid?: undefined;
    phone_input?: undefined;
    country?: undefined;
    country_calling_code?: undefined;
    national_number?: undefined;
    e164?: undefined;
    international?: undefined;
    national?: undefined;
    type?: undefined;
    reason?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    valid: boolean;
    phone_input: string;
    country: import("libphonenumber-js").CountryCode | undefined;
    country_calling_code: string;
    national_number: import("libphonenumber-js").NationalNumber;
    e164: string;
    international: string;
    national: string;
    type: string;
    error?: undefined;
    reason?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    valid: boolean;
    reason: string;
    detail: any;
    phone_input: string;
    error?: undefined;
    country?: undefined;
    country_calling_code?: undefined;
    national_number?: undefined;
    e164?: undefined;
    international?: undefined;
    national?: undefined;
    type?: undefined;
}>;
export declare function currencyConvert(payload: any): Promise<{
    ok: boolean;
    error: string;
    detail?: undefined;
    from?: undefined;
    to?: undefined;
    amount?: undefined;
    rate?: undefined;
    converted?: undefined;
    display?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    from?: undefined;
    to?: undefined;
    amount?: undefined;
    rate?: undefined;
    converted?: undefined;
    display?: undefined;
} | {
    ok: boolean;
    from: string;
    to: string;
    amount: number;
    rate: number;
    converted: number;
    display: string;
    error?: undefined;
    detail?: undefined;
}>;
export declare function timezoneConvert(payload: any): Promise<{
    ok: boolean;
    error: string;
    input_datetime?: undefined;
    from_tz?: undefined;
    to_tz?: undefined;
    converted_datetime?: undefined;
    converted_display?: undefined;
    utc_offset_hours?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    input_datetime: string;
    from_tz: any;
    to_tz: any;
    converted_datetime: string;
    converted_display: string;
    utc_offset_hours: number | null;
    error?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    input_datetime?: undefined;
    from_tz?: undefined;
    to_tz?: undefined;
    converted_datetime?: undefined;
    converted_display?: undefined;
    utc_offset_hours?: undefined;
}>;
export declare function sentimentAnalysis(payload: any): Promise<{
    ok: false;
    error: string;
    detail?: string;
} | {
    ok: boolean;
    error: string;
    max?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
} | {
    char_count: number;
    sentiment: string;
    score: number;
    confidence: number;
    emotions: Record<string, number>;
    summary: string;
    ok: boolean;
    error?: undefined;
    max?: undefined;
}>;
export declare function summarize(payload: any): Promise<{
    ok: false;
    error: string;
    detail?: string;
} | {
    ok: boolean;
    error: string;
    max?: undefined;
    supported?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    supported?: undefined;
} | {
    ok: boolean;
    error: string;
    supported: string[];
    max?: undefined;
} | {
    summary: string;
    ok: boolean;
    style: any;
    input_length: number;
    error?: undefined;
    max?: undefined;
    supported?: undefined;
} | {
    headline: string;
    subheadline: string;
    ok: boolean;
    style: any;
    input_length: number;
    error?: undefined;
    max?: undefined;
    supported?: undefined;
}>;
export declare function extractEntities(payload: any): Promise<{
    ok: false;
    error: string;
    detail?: string;
} | {
    ok: boolean;
    error: string;
    max?: undefined;
    entities?: undefined;
    total_count?: undefined;
    types_requested?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    entities?: undefined;
    total_count?: undefined;
    types_requested?: undefined;
} | {
    ok: boolean;
    entities: Record<string, string[]>;
    total_count: number;
    types_requested: any[];
    error?: undefined;
    max?: undefined;
}>;
export declare function languageDetect(payload: any): Promise<{
    ok: false;
    error: string;
    detail?: string;
} | {
    ok: boolean;
    error: string;
} | {
    language: string;
    language_code: string;
    confidence: number;
    script: string;
    alternatives: Array<{
        language: string;
        language_code: string;
        confidence: number;
    }>;
    ok: boolean;
    error?: undefined;
}>;
export declare function piiDetect(payload: any): Promise<{
    ok: false;
    error: string;
    detail?: string;
} | {
    ok: boolean;
    error: string;
    max?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
} | {
    redact_requested: any;
    redacted_text: string | null;
    findings_count: number;
    has_pii: boolean;
    findings: Array<{
        type: string;
        value: string;
        start?: number;
        end?: number;
    }>;
    risk_level: string;
    ok: boolean;
    error?: undefined;
    max?: undefined;
}>;
export declare function readabilityScore(payload: any): Promise<{
    ok: boolean;
    error: string;
    flesch_reading_ease?: undefined;
    flesch_kincaid_grade?: undefined;
    grade_label?: undefined;
    word_count?: undefined;
    sentence_count?: undefined;
    syllable_count?: undefined;
    char_count?: undefined;
    avg_words_per_sentence?: undefined;
    avg_syllables_per_word?: undefined;
    estimated_read_time?: undefined;
    estimated_read_seconds?: undefined;
} | {
    ok: boolean;
    flesch_reading_ease: number;
    flesch_kincaid_grade: number;
    grade_label: string;
    word_count: number;
    sentence_count: number;
    syllable_count: number;
    char_count: number;
    avg_words_per_sentence: number;
    avg_syllables_per_word: number;
    estimated_read_time: string;
    estimated_read_seconds: number;
    error?: undefined;
}>;
export declare function rssParse(payload: any): Promise<{
    ok: boolean;
    error: string;
    status?: undefined;
    feed?: undefined;
    items?: undefined;
    count?: undefined;
    format?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    feed?: undefined;
    items?: undefined;
    count?: undefined;
    format?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    feed: {
        title: string;
        description: string;
        link: string;
        url: string;
    };
    items: any;
    count: any;
    format: string;
    error?: undefined;
    status?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    status?: undefined;
    feed?: undefined;
    items?: undefined;
    count?: undefined;
    format?: undefined;
}>;
export declare function generateUuid(payload: any): Promise<{
    ok: boolean;
    error: string;
    supported: string[];
    type?: undefined;
    count?: undefined;
    uuids?: undefined;
    uuid?: undefined;
    random_token?: undefined;
    api_key_format?: undefined;
} | {
    ok: boolean;
    type: any;
    count: number;
    uuids: string[];
    uuid: string;
    random_token: string;
    api_key_format: string;
    error?: undefined;
    supported?: undefined;
}>;
export declare function regexGenerate(payload: any): Promise<{
    ok: false;
    error: string;
    detail?: string;
} | {
    ok: boolean;
    error: string;
} | {
    verified: boolean;
    verify_error: string | null;
    regex: string;
    flags: string;
    explanation: string;
    examples: Array<{
        input: string;
        matches: boolean;
        groups?: string[];
    }>;
    ok: boolean;
    error?: undefined;
}>;
export declare function diffText(payload: any): Promise<{
    ok: boolean;
    error: string;
    supported?: undefined;
    format?: undefined;
    diff?: undefined;
    has_changes?: undefined;
    changes?: undefined;
    stats?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    supported: string[];
    format?: undefined;
    diff?: undefined;
    has_changes?: undefined;
    changes?: undefined;
    stats?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    format: string;
    diff: string;
    has_changes: boolean;
    error?: undefined;
    supported?: undefined;
    changes?: undefined;
    stats?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    format: string;
    changes: {
        type: string;
        value: any;
    }[];
    stats: {
        added: number;
        removed: number;
        unchanged: number;
    };
    error?: undefined;
    supported?: undefined;
    diff?: undefined;
    has_changes?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    format: string;
    changes: {
        type: string;
        lines: any;
    }[];
    stats: {
        lines_added: number;
        lines_removed: number;
    };
    has_changes: boolean;
    error?: undefined;
    supported?: undefined;
    diff?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    supported?: undefined;
    format?: undefined;
    diff?: undefined;
    has_changes?: undefined;
    changes?: undefined;
    stats?: undefined;
}>;
export declare function webSearch(payload: any): Promise<{
    ok: boolean;
    error: string;
    max?: undefined;
    detail?: undefined;
    query?: undefined;
    answer?: undefined;
    results?: undefined;
    result_count?: undefined;
    search_depth?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    detail?: undefined;
    query?: undefined;
    answer?: undefined;
    results?: undefined;
    result_count?: undefined;
    search_depth?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    max?: undefined;
    query?: undefined;
    answer?: undefined;
    results?: undefined;
    result_count?: undefined;
    search_depth?: undefined;
} | {
    ok: boolean;
    query: string;
    answer: any;
    results: any;
    result_count: any;
    search_depth: any;
    error?: undefined;
    max?: undefined;
    detail?: undefined;
}>;
export declare function whoisLookup(payload: any): Promise<{
    ok: boolean;
    error: string;
    status?: undefined;
    detail?: undefined;
    domain?: undefined;
    registered?: undefined;
    registrar?: undefined;
    created?: undefined;
    updated?: undefined;
    expires?: undefined;
    nameservers?: undefined;
    rdap_url?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    detail: string;
    domain?: undefined;
    registered?: undefined;
    registrar?: undefined;
    created?: undefined;
    updated?: undefined;
    expires?: undefined;
    nameservers?: undefined;
    rdap_url?: undefined;
} | {
    ok: boolean;
    domain: string;
    registered: boolean;
    registrar: string | null;
    created: string | null;
    updated: string | null;
    expires: string | null;
    nameservers: any;
    status: any;
    rdap_url: string;
    error?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    status?: undefined;
    domain?: undefined;
    registered?: undefined;
    registrar?: undefined;
    created?: undefined;
    updated?: undefined;
    expires?: undefined;
    nameservers?: undefined;
    rdap_url?: undefined;
}>;
export declare function searchWeb(payload: any): Promise<{
    ok: boolean;
    error: string;
    provider?: undefined;
    status?: undefined;
    detail?: undefined;
    query?: undefined;
    results?: undefined;
} | {
    ok: boolean;
    error: string;
    provider: string;
    status: number;
    detail: any;
    query?: undefined;
    results?: undefined;
} | {
    ok: boolean;
    provider: string;
    query: string;
    results: any;
    error?: undefined;
    status?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    provider: string;
    detail: any;
    status?: undefined;
    query?: undefined;
    results?: undefined;
} | {
    ok: boolean;
    error: string;
    provider: string;
    status: number;
    detail?: undefined;
    query?: undefined;
    results?: undefined;
}>;
export declare function extractPage(payload: any): Promise<{
    ok: boolean;
    error: string;
    max?: undefined;
    status?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    description?: undefined;
    text?: undefined;
    links?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    status?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    description?: undefined;
    text?: undefined;
    links?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    max?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    description?: undefined;
    text?: undefined;
    links?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    content_type: string;
    max?: undefined;
    status?: undefined;
    url?: undefined;
    title?: undefined;
    description?: undefined;
    text?: undefined;
    links?: undefined;
    truncated?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    url: string;
    title: string;
    description: string;
    text: string;
    links: string[];
    truncated: boolean;
    error?: undefined;
    max?: undefined;
    status?: undefined;
    content_type?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    max?: undefined;
    status?: undefined;
    content_type?: undefined;
    url?: undefined;
    title?: undefined;
    description?: undefined;
    text?: undefined;
    links?: undefined;
    truncated?: undefined;
}>;
export declare function extractPdf(payload: any): Promise<any>;
export declare function browserTask(payload: any): Promise<{
    ok: boolean;
    url: string;
    action: string;
    selector: string | null;
    result: any;
    html?: undefined;
    truncated?: undefined;
} | {
    ok: boolean;
    url: string;
    action: string;
    selector: string | null;
    html: any;
    truncated: boolean;
    result?: undefined;
}>;
export declare function screenshotCapture(payload: any): Promise<{
    ok: boolean;
    error: string;
    max?: undefined;
    url?: undefined;
    format?: undefined;
    full_page?: undefined;
    width?: undefined;
    height?: undefined;
    size_bytes?: undefined;
    image?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    url?: undefined;
    format?: undefined;
    full_page?: undefined;
    width?: undefined;
    height?: undefined;
    size_bytes?: undefined;
    image?: undefined;
} | {
    ok: boolean;
    url: string;
    format: string;
    full_page: boolean;
    width: number;
    height: number;
    size_bytes: any;
    image: string;
    error?: undefined;
    max?: undefined;
}>;
export declare function imageGenerate(payload: any): Promise<{
    ok: boolean;
    error: string;
    max?: undefined;
    detail?: undefined;
    provider?: undefined;
    model?: undefined;
    prompt?: undefined;
    revised_prompt?: undefined;
    width?: undefined;
    height?: undefined;
    image?: undefined;
} | {
    ok: boolean;
    error: string;
    max: number;
    detail?: undefined;
    provider?: undefined;
    model?: undefined;
    prompt?: undefined;
    revised_prompt?: undefined;
    width?: undefined;
    height?: undefined;
    image?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    max?: undefined;
    provider?: undefined;
    model?: undefined;
    prompt?: undefined;
    revised_prompt?: undefined;
    width?: undefined;
    height?: undefined;
    image?: undefined;
} | {
    ok: boolean;
    provider: string;
    model: string;
    prompt: string;
    revised_prompt: any;
    width: any;
    height: any;
    image: string;
    error?: undefined;
    max?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    provider: string;
    detail: any;
    max?: undefined;
    model?: undefined;
    prompt?: undefined;
    revised_prompt?: undefined;
    width?: undefined;
    height?: undefined;
    image?: undefined;
} | {
    ok: boolean;
    provider: string;
    prompt: string;
    image: string;
    error?: undefined;
    max?: undefined;
    detail?: undefined;
    model?: undefined;
    revised_prompt?: undefined;
    width?: undefined;
    height?: undefined;
}>;
export declare function htmlToMarkdown(payload: any): Promise<{
    ok: boolean;
    error: string;
    status?: undefined;
    markdown?: undefined;
    char_count?: undefined;
    truncated?: undefined;
    source?: undefined;
} | {
    ok: boolean;
    error: string;
    status: number;
    markdown?: undefined;
    char_count?: undefined;
    truncated?: undefined;
    source?: undefined;
} | {
    ok: boolean;
    markdown: string;
    char_count: number;
    truncated: boolean;
    source: any;
    error?: undefined;
    status?: undefined;
}>;
export declare function urlShorten(payload: any): Promise<{
    ok: boolean;
    error: string;
    detail?: undefined;
    original_url?: undefined;
    short_url?: undefined;
    provider?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    original_url?: undefined;
    short_url?: undefined;
    provider?: undefined;
} | {
    ok: boolean;
    original_url: string;
    short_url: any;
    provider: string;
    error?: undefined;
    detail?: undefined;
}>;
export declare function webhookSend(payload: any): Promise<{
    ok: boolean;
    error: string;
    allowed?: undefined;
    status?: undefined;
    status_text?: undefined;
    response?: undefined;
    url?: undefined;
    method?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    allowed: string[];
    status?: undefined;
    status_text?: undefined;
    response?: undefined;
    url?: undefined;
    method?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    status: number;
    status_text: string;
    response: any;
    url: string;
    method: string;
    error?: undefined;
    allowed?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    allowed?: undefined;
    status?: undefined;
    status_text?: undefined;
    response?: undefined;
    url?: undefined;
    method?: undefined;
}>;
export declare function jsonpathQuery(payload: any): Promise<{
    ok: boolean;
    error: string;
    detail?: undefined;
    path?: undefined;
    results?: undefined;
    count?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    path?: undefined;
    results?: undefined;
    count?: undefined;
} | {
    ok: boolean;
    path: string;
    results: any[];
    count: number;
    error?: undefined;
    detail?: undefined;
}>;
export declare function barcodeGenerate(payload: any): Promise<{
    ok: boolean;
    error: string;
    supported?: undefined;
    format?: undefined;
    value?: undefined;
    width?: undefined;
    height?: undefined;
    svg?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    supported: string[];
    format?: undefined;
    value?: undefined;
    width?: undefined;
    height?: undefined;
    svg?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    format: string;
    value: string;
    width: number;
    height: number;
    svg: string;
    error?: undefined;
    supported?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    error: string;
    detail: any;
    supported?: undefined;
    format?: undefined;
    value?: undefined;
    width?: undefined;
    height?: undefined;
    svg?: undefined;
}>;
//# sourceMappingURL=builtin.d.ts.map