import { apiRequest } from './api';
import { adminUsersFromPayload, type AdminUsersSearch } from '../lib/adminUsers';

/** Loaded with the private screen, never with a public page's startup code. */
export async function searchAdminUsersFromApi(
  accessToken: string,
  search: AdminUsersSearch,
  signal?: AbortSignal,
) {
  return adminUsersFromPayload(
    await apiRequest<unknown>(
      '/admin/users/search',
      { method: 'POST', body: JSON.stringify(search), cache: 'no-store', signal },
      accessToken,
    ),
  );
}
