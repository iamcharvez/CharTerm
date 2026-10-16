import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppPage =
  | "dashboard"
  | "quick-connect"
  | "connections"
  | "favorites"
  | "recent"
  | "network-scanner"
  | "ip-calculator"
  | "local-terminal"
  | "settings";

export type ConnectionProtocol = "ssh" | "sftp" | "telnet" | "serial";
export type LegacyCompatibility = "host-key" | "mac" | "key-exchange" | "cipher";

export type ConnectionGroup = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  host?: string;
  port?: number;
  username?: string;
  serialPort?: string;
  baudRate?: number;
  groupId?: string;
  allowLegacySshRsa?: boolean;
  allowLegacyMacSha1?: boolean;
  allowLegacyKexSha1?: boolean;
  allowLegacyCiphers?: boolean;
  hasSavedPassword?: boolean;
  favorite: boolean;
  createdAt: number;
  lastUsedAt?: number;
};

export type ConnectionDraft = Omit<
  ConnectionProfile,
  "id" | "favorite" | "createdAt" | "lastUsedAt"
>;

export type TerminalTab = {
  id: string;
  title: string;
  kind: "local" | ConnectionProtocol;
  connection?: ConnectionProfile;
  sessionPassword?: string;
};

type AppState = {
  page: AppPage;
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  profiles: ConnectionProfile[];
  groups: ConnectionGroup[];
  recentProfileIds: string[];
  navigate: (page: AppPage) => void;
  openLocalTerminal: () => void;
  openConnection: (connection: ConnectionProfile, sessionPassword?: string) => void;
  saveProfile: (draft: ConnectionDraft, existingId?: string) => string;
  deleteProfile: (id: string) => void;
  duplicateProfile: (id: string) => void;
  addGroup: (name: string, parentId?: string | null) => string;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  moveProfileToGroup: (profileId: string, groupId?: string | null) => void;
  toggleFavorite: (id: string) => void;
  enableLegacyCompatibility: (
    terminalId: string,
    compatibility: LegacyCompatibility,
  ) => void;
  setSessionUsername: (terminalId: string, username: string) => void;
  selectTerminal: (id: string) => void;
  closeTerminal: (id: string) => void;
};

const makeId = () => crypto.randomUUID();

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      page: "dashboard",
      terminalTabs: [],
      activeTerminalId: null,
      profiles: [],
      groups: [],
      recentProfileIds: [],
      navigate: (page) => set({ page }),
      openLocalTerminal: () =>
        set((state) => {
          const id = makeId();
          return {
            page: "local-terminal",
            terminalTabs: [
              ...state.terminalTabs,
              {
                id,
                title: `Local ${state.terminalTabs.filter((tab) => tab.kind === "local").length + 1}`,
                kind: "local",
              },
            ],
            activeTerminalId: id,
          };
        }),
      openConnection: (connection, sessionPassword) =>
        set((state) => {
          const id = makeId();
          const now = Date.now();
          const isSaved = state.profiles.some(
            (profile) => profile.id === connection.id,
          );
          return {
            page: "local-terminal",
            terminalTabs: [
              ...state.terminalTabs,
              {
                id,
                title: connection.name || connection.host || "Serial",
                kind: connection.protocol,
                connection,
                sessionPassword: sessionPassword || undefined,
              },
            ],
            activeTerminalId: id,
            profiles: isSaved
              ? state.profiles.map((profile) =>
                  profile.id === connection.id
                    ? { ...profile, lastUsedAt: now }
                    : profile,
                )
              : state.profiles,
            recentProfileIds: isSaved
              ? [
                  connection.id,
                  ...state.recentProfileIds.filter(
                    (profileId) => profileId !== connection.id,
                  ),
                ].slice(0, 20)
              : state.recentProfileIds,
          };
        }),
      saveProfile: (draft, existingId) => {
        const id = existingId ?? makeId();
        set((state) => {
          const current = state.profiles.find((profile) => profile.id === id);
          const profile: ConnectionProfile = {
            ...draft,
            id,
            favorite: current?.favorite ?? false,
            createdAt: current?.createdAt ?? Date.now(),
            lastUsedAt: current?.lastUsedAt,
          };
          return {
            profiles: current
              ? state.profiles.map((item) => (item.id === id ? profile : item))
              : [...state.profiles, profile],
          };
        });
        return id;
      },
      deleteProfile: (id) =>
        set((state) => ({
          profiles: state.profiles.filter((profile) => profile.id !== id),
          recentProfileIds: state.recentProfileIds.filter(
            (profileId) => profileId !== id,
          ),
        })),
      duplicateProfile: (id) =>
        set((state) => {
          const source = state.profiles.find((profile) => profile.id === id);
          if (!source) return {};
          return {
            profiles: [
              ...state.profiles,
              {
                ...source,
                id: makeId(),
                name: `${source.name} copy`,
                favorite: false,
                hasSavedPassword: false,
                createdAt: Date.now(),
                lastUsedAt: undefined,
              },
            ],
          };
        }),
      addGroup: (name, parentId = null) => {
        const id = makeId();
        set((state) => ({
          groups: [
            ...state.groups,
            {
              id,
              name: name.trim().slice(0, 60) || "New group",
              parentId:
                parentId && state.groups.some((group) => group.id === parentId)
                  ? parentId
                  : null,
              createdAt: Date.now(),
            },
          ],
        }));
        return id;
      },
      renameGroup: (id, name) =>
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === id
              ? { ...group, name: name.trim().slice(0, 60) || group.name }
              : group,
          ),
        })),
      deleteGroup: (id) =>
        set((state) => {
          const removed = state.groups.find((group) => group.id === id);
          if (!removed) return {};
          return {
            groups: state.groups
              .filter((group) => group.id !== id)
              .map((group) =>
                group.parentId === id
                  ? { ...group, parentId: removed.parentId }
                  : group,
              ),
            profiles: state.profiles.map((profile) =>
              profile.groupId === id
                ? { ...profile, groupId: removed.parentId ?? undefined }
                : profile,
            ),
          };
        }),
      moveProfileToGroup: (profileId, groupId) =>
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === profileId
              ? {
                  ...profile,
                  groupId:
                    groupId && state.groups.some((group) => group.id === groupId)
                      ? groupId
                      : undefined,
                }
              : profile,
          ),
        })),
      toggleFavorite: (id) =>
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id
              ? { ...profile, favorite: !profile.favorite }
              : profile,
          ),
        })),
      enableLegacyCompatibility: (terminalId, compatibility) =>
        set((state) => {
          const terminal = state.terminalTabs.find((tab) => tab.id === terminalId);
          const profileId = terminal?.connection?.id;
          const compatibilityUpdate =
            compatibility === "host-key"
              ? { allowLegacySshRsa: true }
              : compatibility === "mac"
                ? { allowLegacyMacSha1: true }
                : compatibility === "key-exchange"
                  ? { allowLegacyKexSha1: true }
                  : { allowLegacyCiphers: true };
          return {
            terminalTabs: state.terminalTabs.map((tab) =>
              tab.id === terminalId && tab.connection
                ? {
                    ...tab,
                    connection: {
                      ...tab.connection,
                      ...compatibilityUpdate,
                    },
                  }
                : tab,
            ),
            profiles: profileId
              ? state.profiles.map((profile) =>
                  profile.id === profileId
                    ? { ...profile, ...compatibilityUpdate }
                    : profile,
                )
              : state.profiles,
          };
        }),
      setSessionUsername: (terminalId, username) =>
        set((state) => ({
          terminalTabs: state.terminalTabs.map((tab) =>
            tab.id === terminalId && tab.connection
              ? {
                  ...tab,
                  connection: { ...tab.connection, username },
                }
              : tab,
          ),
        })),
      selectTerminal: (id) =>
        set({ page: "local-terminal", activeTerminalId: id }),
      closeTerminal: (id) =>
        set((state) => {
          const index = state.terminalTabs.findIndex((tab) => tab.id === id);
          const terminalTabs = state.terminalTabs.filter(
            (tab) => tab.id !== id,
          );
          const nextTab = terminalTabs[Math.min(index, terminalTabs.length - 1)];
          return {
            terminalTabs,
            activeTerminalId:
              state.activeTerminalId === id
                ? (nextTab?.id ?? null)
                : state.activeTerminalId,
          };
        }),
    }),
    {
      name: "charterm-workspace",
      partialize: (state) => ({
        profiles: state.profiles,
        groups: state.groups,
        recentProfileIds: state.recentProfileIds,
      }),
    },
  ),
);
