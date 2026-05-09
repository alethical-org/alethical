import { Bill, ChatSession, Citation, Legislator } from './types';

const configuredApiOrigin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const API_BASE_URL = configuredApiOrigin ? `${configuredApiOrigin}/api/v1` : null;

interface DetailResponse<T> {
    data: T;
}

interface CollectionResponse<T> {
    data: T[];
}

interface PageResponse<T> extends CollectionResponse<T> {
    page?: {
        limit: number;
        next_cursor?: string | null;
        has_more: boolean;
    } | null;
}

interface ApiChatSessionPayload {
    id: string;
    title?: string | null;
    subject_bill_id?: string | null;
    last_message_at?: string | null;
}

interface ApiSponsorPayload {
    name: string;
    role: string;
    legislator_id?: string | null;
}

interface ApiBillStatsPayload {
    sponsor_count: number;
    action_count: number;
    version_count: number;
    vote_event_count: number;
}

interface ApiBillListItemPayload {
    id: string;
    file_type: string;
    file_number: number;
    title: string;
    current_status?: string | null;
    latest_action_at?: string | null;
    official_url?: string | null;
    chief_sponsors: ApiSponsorPayload[];
    stats?: ApiBillStatsPayload | null;
}

interface ApiTrackedBillPayload {
    bill_id: string;
    alerts_enabled: boolean;
    note?: string | null;
    bill?: ApiBillListItemPayload | null;
}

interface ApiBillActionPayload {
    action_number: number;
    action_text: string;
    action_group?: string | null;
    action_description?: string | null;
    action_at?: string | null;
}

interface ApiDistrictPayload {
    id: string;
    code: string;
    label: string;
}

interface ApiCurrentServicePayload {
    chamber: string;
    party?: string | null;
    district: ApiDistrictPayload;
    email?: string | null;
    phone?: string | null;
    office_address?: string | null;
    profile_url?: string | null;
}

interface ApiLegislatorStatsPayload {
    chief_bill_count: number;
    total_bill_count: number;
    vote_record_count: number;
    committee_count: number;
}

interface ApiCommitteePayload {
    name: string;
    role?: string | null;
}

interface ApiLegislatorListItemPayload {
    id: string;
    slug: string;
    full_name: string;
    current_service?: ApiCurrentServicePayload | null;
    stats?: ApiLegislatorStatsPayload | null;
}

interface ApiLegislatorDetailPayload extends ApiLegislatorListItemPayload {
    biography?: string | null;
    committees?: ApiCommitteePayload[] | null;
}

interface ApiBillVersionPayload {
    version_code: string;
    version_name?: string | null;
    html_url?: string | null;
    pdf_url?: string | null;
    is_current: boolean;
}

interface ApiTopicPayload {
    slug: string;
    name: string;
}

interface ApiBillDetailPayload {
    id: string;
    title: string;
    description?: string | null;
    current_status?: string | null;
    latest_action_at?: string | null;
    official_url?: string | null;
    chief_sponsors: ApiSponsorPayload[];
    actions?: ApiBillActionPayload[] | null;
    versions?: ApiBillVersionPayload[] | null;
    topics?: ApiTopicPayload[] | null;
    ai_summary?: ApiAiSummaryPayload | null;
}

type ApiAiSummaryPayload = Record<string, unknown>;

interface ApiBillVotePayload {
    id: string;
    motion_text?: string | null;
    result_text?: string | null;
    yes_count?: number | null;
    no_count?: number | null;
}

interface ApiChatMessagePayload {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    citations?: Array<{
        citation_label?: string;
        excerpt?: string;
        url?: string | null;
        bill_id?: string;
    }>;
    created_at: string;
}

function apiUrl(path: string) {
    if (!API_BASE_URL) {
        throw new Error('Chat API is not configured for this deployment.');
    }

    return `${API_BASE_URL}${path}`;
}

function publicApiUrl(path: string) {
    if (!API_BASE_URL) {
        throw new Error('Public API is not configured for this deployment.');
    }

    return `${API_BASE_URL}${path}`;
}

async function apiRequest<T>(path: string, init: RequestInit, accessToken: string): Promise<T> {
    const response = await fetch(apiUrl(path), {
        ...init,
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : null),
            ...(init.headers ?? {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `API request failed with ${response.status}`);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return (await response.json()) as T;
}

async function publicApiRequest<T>(path: string): Promise<T> {
    const response = await fetch(publicApiUrl(path), {
        method: 'GET',
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `API request failed with ${response.status}`);
    }

    return (await response.json()) as T;
}

function toChamber(fileType: string): Bill['chamber'] {
    return fileType.toUpperCase() === 'HF' ? 'House' : 'Senate';
}

function toLegislatorChamber(chamber?: string | null): Legislator['chamber'] {
    return chamber?.toLowerCase() === 'house' ? 'House' : 'Senate';
}

function toParty(party?: string | null): Legislator['party'] {
    const normalized = party?.trim().toUpperCase();
    if (normalized === 'R' || normalized === 'REPUBLICAN') {
        return 'R';
    }
    if (normalized === 'I' || normalized === 'INDEPENDENT') {
        return 'I';
    }
    return 'D';
}

function formatBillIdentifier(fileType: string, fileNumber: number) {
    return `${fileType.toUpperCase()} ${fileNumber}`;
}

function formatUpdatedAt(date?: string | null) {
    return date ? date.slice(0, 10) : 'Unknown';
}

function normalizeBillIdForApi(billId: string) {
    const canonical = billId.match(/^\d{2,3}-\d{4}-(SF|HF)\d+$/i);
    if (canonical) {
        return billId.toUpperCase();
    }

    const legacy = billId.match(/^bill-(sf|hf)(\d+)$/i);
    if (legacy) {
        const [, fileType, fileNumber] = legacy;
        return `94-2025-${fileType.toUpperCase()}${fileNumber}`;
    }

    return billId;
}

function emptyBriefing(): Bill['briefing'] {
    return {
        what: 'Live bill details are loading from the backend.',
        why: 'This bill is now coming from the real API instead of the demo dataset.',
        keyChanges: [],
        whoAffected: [],
        supportersMaySay: [],
        concernsMayRaise: [],
    };
}

function firstSummaryString(summary: ApiAiSummaryPayload | null | undefined, keys: string[], fallback: string) {
    for (const key of keys) {
        const value = summary?.[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return fallback;
}

function firstSummaryList(summary: ApiAiSummaryPayload | null | undefined, keys: string[]) {
    for (const key of keys) {
        const value = summary?.[key];
        if (Array.isArray(value)) {
            return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }
        if (typeof value === 'string' && value.trim()) {
            return [value.trim()];
        }
    }
    return [];
}

function briefingFromSummary(
    summary: ApiAiSummaryPayload | null | undefined,
    description?: string | null
): Bill['briefing'] {
    return {
        what: firstSummaryString(
            summary,
            ['what', 'plain_language_summary', 'summary'],
            description ?? 'Live bill detail loaded from the backend.'
        ),
        why: firstSummaryString(
            summary,
            ['why', 'why_it_matters'],
            'Official bill status, sponsors, actions, and versions are loaded from the backend.'
        ),
        keyChanges: firstSummaryList(summary, ['key_changes', 'keyChanges']),
        whoAffected: firstSummaryList(summary, ['who_affected', 'whoAffected']),
        supportersMaySay: firstSummaryList(summary, ['supporters_may_say', 'supportersMaySay']),
        concernsMayRaise: firstSummaryList(summary, ['concerns_may_raise', 'concernsMayRaise']),
    };
}

function shortName(fullName: string) {
    return fullName
        .replace(/^(Rep\.|Representative|Sen\.|Senator)\s+/i, '')
        .trim();
}

function legislatorRole(payload: ApiLegislatorListItemPayload) {
    const service = payload.current_service;
    if (!service) {
        return 'Current service unavailable';
    }
    const chamber = toLegislatorChamber(service.chamber);
    return `${chamber} District ${service.district.code}`;
}

function mapLegislator(
    payload: ApiLegislatorListItemPayload | ApiLegislatorDetailPayload
): Legislator {
    const service = payload.current_service;
    const chamber = toLegislatorChamber(service?.chamber);
    const party = toParty(service?.party);
    const district = service?.district.code ?? 'Unknown';
    const displayName = payload.full_name;
    const committees = 'committees' in payload
        ? (payload.committees ?? []).map((committee) =>
            committee.role ? `${committee.name} (${committee.role})` : committee.name
        )
        : [];
    const stats = payload.stats;
    const focusAreas = [
        stats ? `${stats.total_bill_count} sponsored bills` : null,
        stats ? `${stats.committee_count} committees` : null,
    ].filter((item): item is string => Boolean(item));

    return {
        id: payload.id,
        name: displayName,
        shortName: shortName(displayName),
        chamber,
        district,
        party,
        role: legislatorRole(payload),
        bio: ('biography' in payload ? payload.biography : null) ?? 'Live legislator profile loaded from the backend.',
        committees,
        focusAreas,
        serviceHistory: service
            ? [{
                id: `${payload.id}-current-service`,
                startYear: 2025,
                endYear: null,
                chamber,
                district,
                party,
                role: legislatorRole(payload),
            }]
            : [],
        questionPrompts: [
            `Summarize ${displayName}'s sponsored bills this session.`,
            `What committees or policy areas are connected to ${displayName}?`,
        ],
        sponsoredBillIds: [],
        voteEventRefs: [],
    };
}

function mapBillSummary(payload: ApiBillListItemPayload): Bill & { sponsorNames: string[] } {
    return {
        id: payload.id,
        identifier: formatBillIdentifier(payload.file_type, payload.file_number),
        title: payload.title,
        chamber: toChamber(payload.file_type),
        status: payload.current_status ?? 'Status unavailable',
        updatedAt: formatUpdatedAt(payload.latest_action_at),
        sessionLabel: 'Current session',
        topics: [],
        chiefSponsorIds: payload.chief_sponsors.map((sponsor) => sponsor.legislator_id ?? sponsor.name),
        actionCount: payload.stats?.action_count ?? 0,
        versionCount: payload.stats?.version_count ?? 0,
        rollCallCount: payload.stats?.vote_event_count ?? 0,
        briefing: emptyBriefing(),
        questionPrompts: [],
        actions: [],
        versions: [],
        votes: [],
        citations: [],
        officialLinks: payload.official_url
            ? [{ id: `${payload.id}-official`, label: 'Official bill page', url: payload.official_url }]
            : [],
        sponsorNames: payload.chief_sponsors.map((sponsor) => sponsor.name),
    };
}

function mapBillDetail(
    payload: ApiBillDetailPayload,
    votes: ApiBillVotePayload[]
): Bill & { sponsorNames: string[] } {
    const fileMatch = payload.id.match(/-(SF|HF)(\d+)$/i);
    const fileType = fileMatch?.[1]?.toUpperCase() ?? 'SF';
    const fileNumber = fileMatch?.[2] ? Number(fileMatch[2]) : 0;

    return {
        id: payload.id,
        identifier: fileNumber ? formatBillIdentifier(fileType, fileNumber) : payload.id,
        title: payload.title,
        chamber: toChamber(fileType),
        status: payload.current_status ?? 'Status unavailable',
        updatedAt: formatUpdatedAt(payload.latest_action_at),
        sessionLabel: 'Current session',
        topics: (payload.topics ?? []).map((topic) => topic.name),
        chiefSponsorIds: payload.chief_sponsors.map((sponsor) => sponsor.legislator_id ?? sponsor.name),
        actionCount: payload.actions?.length ?? 0,
        versionCount: payload.versions?.length ?? 0,
        rollCallCount: votes.length,
        briefing: briefingFromSummary(payload.ai_summary, payload.description),
        questionPrompts: [],
        actions: (payload.actions ?? []).map((action) => ({
            id: `${payload.id}-action-${action.action_number}`,
            date: formatUpdatedAt(action.action_at),
            description: action.action_description ?? action.action_text,
        })),
        versions: (payload.versions ?? []).map((version) => ({
            id: `${payload.id}-version-${version.version_code}`,
            label: version.version_name ?? version.version_code,
            date: version.is_current ? 'Current version' : '',
            summary: version.version_code,
            url: version.html_url ?? version.pdf_url ?? payload.official_url ?? '',
        })),
        votes: votes.map((vote) => ({
            id: vote.id,
            motion: vote.motion_text ?? 'Vote',
            date: '',
            result: vote.result_text ?? 'Result unavailable',
            breakdown: {
                yes: vote.yes_count ?? 0,
                no: vote.no_count ?? 0,
                absent: 0,
            },
            votes: [],
        })),
        citations: [],
        officialLinks: payload.official_url
            ? [{ id: `${payload.id}-official`, label: 'Official bill page', url: payload.official_url }]
            : [],
        sponsorNames: payload.chief_sponsors.map((sponsor) => sponsor.name),
    };
}

function normalizeBillSubjectId(subjectId?: string, subjectLabel?: string) {
    if (subjectId?.match(/^\d{2,3}-\d{4}-(SF|HF)\d+$/i)) {
        return subjectId.toUpperCase();
    }

    const fromLabel = subjectLabel?.match(/^(SF|HF)\s*(\d+)$/i);
    if (fromLabel) {
        const [, fileType, fileNumber] = fromLabel;
        return `94-2025-${fileType.toUpperCase()}${fileNumber}`;
    }

    const fromLocalId = subjectId?.match(/^bill-(sf|hf)(\d+)$/i);
    if (fromLocalId) {
        const [, fileType, fileNumber] = fromLocalId;
        return `94-2025-${fileType.toUpperCase()}${fileNumber}`;
    }

    return undefined;
}

function mapCitation(citation: NonNullable<ApiChatMessagePayload['citations']>[number], index: number): Citation {
    return {
        id: `${citation.bill_id ?? 'citation'}-${index}`,
        label: citation.citation_label ?? 'Grounding citation',
        excerpt: citation.excerpt ?? (citation.bill_id ? `Grounded in ${citation.bill_id}` : 'Grounded legislative text'),
        url: citation.url ?? '',
    };
}

function mapChatSessionPayload(session: ApiChatSessionPayload, messages: ApiChatMessagePayload[]): ChatSession {
    return {
        id: session.id,
        title: session.title ?? 'Conversation',
        userId: 'user-demo-1',
        subjectType: session.subject_bill_id ? 'bill' : 'general',
        subjectId: session.subject_bill_id ?? undefined,
        subjectLabel: session.subject_bill_id ?? undefined,
        updatedAt: session.last_message_at ?? messages.at(-1)?.created_at ?? new Date().toISOString(),
        messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.content,
            createdAt: message.created_at,
            citations: (message.citations ?? []).map(mapCitation),
        })),
    };
}

export async function listChatSessionsFromApi(accessToken: string): Promise<ChatSession[]> {
    const response = await apiRequest<CollectionResponse<ApiChatSessionPayload>>(
        '/me/chat-sessions',
        { method: 'GET' },
        accessToken
    );

    return response.data.map((session) => ({
        id: session.id,
        title: session.title ?? 'Conversation',
        userId: 'user-demo-1',
        subjectType: session.subject_bill_id ? 'bill' : 'general',
        subjectId: session.subject_bill_id ?? undefined,
        subjectLabel: session.subject_bill_id ?? undefined,
        updatedAt: session.last_message_at ?? new Date().toISOString(),
        messages: [],
    }));
}

export async function getChatSessionFromApi(
    accessToken: string,
    sessionId: string
): Promise<ChatSession | null> {
    const [sessionResponse, messagesResponse] = await Promise.all([
        apiRequest<DetailResponse<ApiChatSessionPayload>>(
            `/me/chat-sessions/${sessionId}`,
            { method: 'GET' },
            accessToken
        ),
        apiRequest<CollectionResponse<ApiChatMessagePayload>>(
            `/me/chat-sessions/${sessionId}/messages`,
            { method: 'GET' },
            accessToken
        ),
    ]);

    return mapChatSessionPayload(sessionResponse.data, messagesResponse.data);
}

export async function createChatSessionFromApi(
    accessToken: string,
    input: {
        title: string;
        subjectType: 'bill' | 'legislator' | 'general';
        subjectId?: string;
        seedPrompt?: string;
        subjectLabel?: string;
    }
): Promise<ChatSession> {
    const subjectBillId =
        input.subjectType === 'bill'
            ? normalizeBillSubjectId(input.subjectId, input.subjectLabel)
            : undefined;

    const sessionResponse = await apiRequest<DetailResponse<ApiChatSessionPayload>>(
        '/me/chat-sessions',
        {
            method: 'POST',
            body: JSON.stringify({
                title: input.title,
                subject_bill_id: subjectBillId,
            }),
        },
        accessToken
    );

    if (input.seedPrompt?.trim()) {
        await apiRequest<DetailResponse<{ assistant_message: ApiChatMessagePayload }>>(
            `/me/chat-sessions/${sessionResponse.data.id}/messages`,
            {
                method: 'POST',
                body: JSON.stringify({
                    content: input.seedPrompt.trim(),
                    stream: false,
                }),
            },
            accessToken
        );
    }

    const hydrated = await getChatSessionFromApi(accessToken, sessionResponse.data.id);
    if (!hydrated) {
        throw new Error('Chat session was created but could not be loaded');
    }
    return hydrated;
}

export async function sendChatMessageToApi(
    accessToken: string,
    input: { sessionId: string; text: string }
): Promise<ChatSession | null> {
    await apiRequest<DetailResponse<{ assistant_message: ApiChatMessagePayload }>>(
        `/me/chat-sessions/${input.sessionId}/messages`,
        {
            method: 'POST',
            body: JSON.stringify({
                content: input.text,
                stream: false,
            }),
        },
        accessToken
    );

    return getChatSessionFromApi(accessToken, input.sessionId);
}

export async function listBillsFromApi(
    query?: string,
    session?: string
): Promise<Array<Bill & { sponsorNames: string[] }>> {
    const params = new URLSearchParams();
    params.set('limit', '20');
    if (query?.trim()) {
        params.set('q', query.trim());
    }
    if (session?.trim()) {
        params.set('session', session.trim());
    }

    const response = await publicApiRequest<PageResponse<ApiBillListItemPayload>>(
        `/bills?${params.toString()}`
    );

    return response.data.map(mapBillSummary);
}

export async function getBillFromApi(billId: string): Promise<(Bill & { sponsorNames: string[] }) | null> {
    const apiBillId = normalizeBillIdForApi(billId);
    const [detailResponse, votesResponse] = await Promise.all([
        publicApiRequest<DetailResponse<ApiBillDetailPayload>>(
            `/bills/${encodeURIComponent(apiBillId)}?include=actions,versions,topics,ai_summary`
        ),
        publicApiRequest<PageResponse<ApiBillVotePayload>>(`/bills/${encodeURIComponent(apiBillId)}/votes`),
    ]);

    return mapBillDetail(detailResponse.data, votesResponse.data);
}

export async function listLegislatorsFromApi(query?: string): Promise<Legislator[]> {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (query?.trim()) {
        params.set('q', query.trim());
    }

    const response = await publicApiRequest<PageResponse<ApiLegislatorListItemPayload>>(
        `/legislators?${params.toString()}`
    );

    return response.data.map(mapLegislator);
}

export async function getLegislatorFromApi(legislatorId: string): Promise<Legislator | null> {
    const response = await publicApiRequest<DetailResponse<ApiLegislatorDetailPayload>>(
        `/legislators/${encodeURIComponent(legislatorId)}?include=current_service,committees,stats`
    );

    return mapLegislator(response.data);
}

export async function getLegislatorBillsFromApi(
    legislatorId: string
): Promise<Array<Bill & { sponsorNames: string[] }>> {
    const response = await publicApiRequest<PageResponse<ApiBillListItemPayload>>(
        `/legislators/${encodeURIComponent(legislatorId)}/bills?limit=20`
    );

    return response.data.map(mapBillSummary);
}

export async function listTrackedBillsFromApi(accessToken: string): Promise<Array<Bill & { sponsorNames: string[] }>> {
    const response = await apiRequest<CollectionResponse<ApiTrackedBillPayload>>(
        '/me/tracked-bills',
        { method: 'GET' },
        accessToken
    );

    return response.data
        .filter((tracked) => tracked.bill)
        .map((tracked) => mapBillSummary(tracked.bill as ApiBillListItemPayload));
}

export async function toggleTrackedBillFromApi(accessToken: string, billId: string): Promise<void> {
    const trackedBills = await apiRequest<CollectionResponse<ApiTrackedBillPayload>>(
        '/me/tracked-bills',
        { method: 'GET' },
        accessToken
    );
    const isTracked = trackedBills.data.some((tracked) => tracked.bill_id === billId);

    if (isTracked) {
        await apiRequest<void>(
            `/me/tracked-bills/${encodeURIComponent(billId)}`,
            { method: 'DELETE' },
            accessToken
        );
        return;
    }

    await apiRequest<DetailResponse<ApiTrackedBillPayload>>(
        `/me/tracked-bills/${encodeURIComponent(billId)}`,
        {
            method: 'PUT',
            body: JSON.stringify({
                alerts_enabled: true,
                note: null,
            }),
        },
        accessToken
    );
}
