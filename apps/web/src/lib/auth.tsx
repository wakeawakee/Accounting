import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; name: string; email: string; role: 'owner' | 'staff' };
  firm: { id: string; name: string; hasLogo: boolean };
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}
