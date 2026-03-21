import { ChatSession, Citation } from './types';

const configuredApiOrigin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const API_BASE_URL = configuredApiOrigin ? `${configuredApiOrigin}/api/v1` : null;

interface DetailResponse<T> {
  data: T;
}

interface CollectionResponse<T> {
  data: T[];
}

interface ApiChatSessionPayload {
  id: string;
  title?: string | null;
  subject_bill_id?: string | null;
  last_message_at?: string | null;
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
