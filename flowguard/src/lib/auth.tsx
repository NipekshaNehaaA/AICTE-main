import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface SessionUser {
  id: string;
  loginId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  designation: string | null;
  roles: string[];
  activeRole: string;
}
export type Workspace = 'INSTITUTION' | 'OFFICIAL' | 'GOVERNANCE';

export type LoginResult =
  | { success: true; workspace: Workspace; user: SessionUser }
  | { requireTotp: true; challengeToken: string; loginId: string; fullName: string }
  | { requireTotpSetup: true; challengeToken: string; secret: string; qrCodeDataUrl: string; loginId: string; fullName: string };

interface AuthState {
  user: SessionUser | null;
  workspace: Workspace | null;
  ready: boolean;
  login: (loginId: string, password: string, totpCode?: string) => Promise<LoginResult>;
  verifyTotp: (challengeToken: string, code: string) => Promise<Workspace>;
  logout: () => Promise<void>;
  switchRole: (role: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then((r) => {
        setUser(r.user);
        setWorkspace(r.workspace);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
    const onUnauth = () => {
      setUser(null);
      setWorkspace(null);
    };
    window.addEventListener('fg:unauthenticated', onUnauth);
    return () => window.removeEventListener('fg:unauthenticated', onUnauth);
  }, []);

  const login = useCallback(async (loginId: string, password: string, totpCode?: string): Promise<LoginResult> => {
    const r = await api.post('/api/auth/login', { loginId, password, totpCode });
    if (r.requireTotp || r.requireTotpSetup) {
      return r as LoginResult;
    }
    setUser(r.user);
    setWorkspace(r.workspace);
    return { success: true, workspace: r.workspace as Workspace, user: r.user };
  }, []);

  const verifyTotp = useCallback(async (challengeToken: string, code: string): Promise<Workspace> => {
    const r = await api.post('/api/auth/verify-totp', { challengeToken, code });
    setUser(r.user);
    setWorkspace(r.workspace);
    return r.workspace as Workspace;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
    setWorkspace(null);
  }, []);
  const switchRole = useCallback(async (role: string) => {
    const r = await api.post('/api/auth/switch-role', { role });
    setUser(r.user);
    setWorkspace(r.workspace);
  }, []);

  return <Ctx.Provider value={{ user, workspace, ready, login, verifyTotp, logout, switchRole }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
