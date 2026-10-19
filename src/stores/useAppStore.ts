import { create } from "zustand";
import { loadPreferences, type CharTermPreferences } from "../lib/preferences";

export type AppPage =
  | "dashboard"
  | "quick-connect"
  | "connections"
  | "favorites"
  | "recent"
  | "network-scanner"
  | "ip-calculator"
  | "identities"
  | "workspaces"
  | "local-terminal"
  | "settings";

export type ConnectionProtocol = "ssh" | "sftp" | "telnet" | "serial" | "tcp";
export type LegacyCompatibility = "host-key" | "mac" | "key-exchange" | "cipher";
export type TerminalLayout = "single" | "columns" | "rows" | "grid";
export type AuthenticationMode = "auto" | "identity" | "agent" | "password";
export type SerialParity = "none" | "odd" | "even";
export type SerialFlowControl = "none" | "hardware" | "software";
export type SerialEncoding = "utf-8" | "windows-1252" | "iso-8859-1";

export type SshIdentity = {
  id: string;
  name: string;
  privateKeyPath: string;
  publicKeyPath?: string;
  certificatePath?: string;
  publicKey?: string;
  fingerprint: string;
  algorithm: string;
  hasSavedPassphrase?: boolean;
  createdAt: number;
};

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
  serialDataBits?: 5 | 6 | 7 | 8;
  serialStopBits?: 1 | 2;
  serialParity?: SerialParity;
  serialFlowControl?: SerialFlowControl;
  serialEncoding?: SerialEncoding;
  groupId?: string;
  allowLegacySshRsa?: boolean;
  allowLegacyMacSha1?: boolean;
  allowLegacyKexSha1?: boolean;
  allowLegacyCiphers?: boolean;
  hasSavedPassword?: boolean;
  authenticationMode?: AuthenticationMode;
  identityId?: string;
  jumpHost?: string;
  jumpPort?: number;
  jumpUsername?: string;
  startupCommand?: string;
  enableCompression?: boolean;
  agentForwarding?: boolean;
  localForward?: string;
  remoteForward?: string;
  dynamicForward?: number;
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
  sessionKeyPassphrase?: string;
  restored?: boolean;
};

export type PersistentAppState = {
  preferences?: CharTermPreferences;
  profiles: ConnectionProfile[];
  groups: ConnectionGroup[];
  identities: SshIdentity[];
  recentProfileIds: string[];
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  terminalLayout: TerminalLayout;
  terminalPaneIds: string[];
};

type AppState = {
  databaseReady: boolean;
  page: AppPage;
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  terminalLayout: TerminalLayout;
  terminalPaneIds: string[];
  editingProfileId: string | null;
  profiles: ConnectionProfile[];
  groups: ConnectionGroup[];
  identities: SshIdentity[];
  recentProfileIds: string[];
  hydrateApplicationState: (snapshot?: Partial<PersistentAppState>) => void;
  navigate: (page: AppPage) => void;
  editConnection: (id: string) => void;
  openLocalTerminal: () => void;
  openConnection: (connection: ConnectionProfile, sessionPassword?: string, sessionKeyPassphrase?: string) => void;
  saveIdentity: (identity: Omit<SshIdentity, "id" | "createdAt">, existingId?: string) => string;
  deleteIdentity: (id: string) => void;
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
  setTerminalLayout: (layout: TerminalLayout) => void;
  addTerminalPane: () => void;
  removeTerminalPane: (id: string) => void;
  closeTerminal: (id: string) => void;
};

const makeId = () => crypto.randomUUID();

function terminalPaneLimit(layout: TerminalLayout) {
  if (layout === "single") return 0;
  if (layout === "grid") return 4;
  return 2;
}

export const useAppStore = create<AppState>()(
    (set) => ({
      databaseReady: false,
      page: "dashboard",
      terminalTabs: [],
      activeTerminalId: null,
      terminalLayout: "single",
      terminalPaneIds: [],
      editingProfileId: null,
      profiles: [],
      groups: [],
      identities: [],
      recentProfileIds: [],
      hydrateApplicationState: (snapshot) =>
        set((state) => {
          const terminalTabs = Array.isArray(snapshot?.terminalTabs)
            ? snapshot.terminalTabs.map((tab) => ({
                ...tab,
                sessionPassword: undefined,
                sessionKeyPassphrase: undefined,
                restored: true,
              }))
            : state.terminalTabs;
          const terminalIds = new Set(terminalTabs.map((tab) => tab.id));
          const requestedActiveId = snapshot?.activeTerminalId ?? null;
          return {
            databaseReady: true,
            profiles: Array.isArray(snapshot?.profiles) ? snapshot.profiles : state.profiles,
            groups: Array.isArray(snapshot?.groups) ? snapshot.groups : state.groups,
            identities: Array.isArray(snapshot?.identities) ? snapshot.identities : state.identities,
            recentProfileIds: Array.isArray(snapshot?.recentProfileIds)
              ? snapshot.recentProfileIds
              : state.recentProfileIds,
            terminalTabs,
            activeTerminalId: requestedActiveId && terminalIds.has(requestedActiveId)
              ? requestedActiveId
              : terminalTabs[0]?.id ?? null,
            terminalLayout: snapshot?.terminalLayout ?? state.terminalLayout,
            terminalPaneIds: Array.isArray(snapshot?.terminalPaneIds)
              ? snapshot.terminalPaneIds
                  .filter((id) => terminalIds.has(id))
                  .slice(0, terminalPaneLimit(snapshot?.terminalLayout ?? state.terminalLayout))
              : state.terminalPaneIds,
          };
        }),
      navigate: (page) => set({ page, editingProfileId: null }),
      editConnection: (id) =>
        set((state) => ({
          page: state.profiles.some((profile) => profile.id === id)
            ? "quick-connect"
            : state.page,
          editingProfileId: state.profiles.some((profile) => profile.id === id)
            ? id
            : null,
        })),
      openLocalTerminal: () =>
        set((state) => {
          const id = makeId();
          const terminalPaneIds = state.terminalLayout === "single"
            ? state.terminalPaneIds
            : state.terminalPaneIds.map((paneId) =>
                paneId === state.activeTerminalId ? id : paneId,
              );
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
            terminalPaneIds,
          };
        }),
      openConnection: (connection, sessionPassword, sessionKeyPassphrase) =>
        set((state) => {
          const id = makeId();
          const now = Date.now();
          const isSaved = state.profiles.some(
            (profile) => profile.id === connection.id,
          );
          const terminalPaneIds = state.terminalLayout === "single"
            ? state.terminalPaneIds
            : state.terminalPaneIds.map((paneId) =>
                paneId === state.activeTerminalId ? id : paneId,
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
                sessionKeyPassphrase: sessionKeyPassphrase || undefined,
              },
            ],
            activeTerminalId: id,
            terminalPaneIds,
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
      saveIdentity: (identity, existingId) => {
        const id = existingId ?? makeId();
        set((state) => {
          const current = state.identities.find((item) => item.id === id);
          const next: SshIdentity = {
            ...identity,
            id,
            createdAt: current?.createdAt ?? Date.now(),
          };
          return {
            identities: current
              ? state.identities.map((item) => item.id === id ? next : item)
              : [...state.identities, next],
          };
        });
        return id;
      },
      deleteIdentity: (id) => set((state) => ({
        identities: state.identities.filter((item) => item.id !== id),
        profiles: state.profiles.map((profile) => profile.identityId === id
          ? { ...profile, identityId: undefined, authenticationMode: "auto" }
          : profile),
      })),
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
        set((state) => {
          if (state.terminalLayout === "single" || state.terminalPaneIds.includes(id)) {
            return { page: "local-terminal", activeTerminalId: id };
          }
          const replaceIndex = Math.max(
            0,
            state.terminalPaneIds.indexOf(state.activeTerminalId ?? ""),
          );
          const terminalPaneIds = [...state.terminalPaneIds];
          terminalPaneIds[replaceIndex] = id;
          return { page: "local-terminal", activeTerminalId: id, terminalPaneIds };
        }),
      setTerminalLayout: (layout) =>
        set((state) => {
          if (layout === "single") {
            return { terminalLayout: layout, terminalPaneIds: [] };
          }
          const availableIds = state.terminalTabs.map((tab) => tab.id);
          const existingIds = state.terminalPaneIds.filter((id) => availableIds.includes(id));
          const orderedIds = [
            ...(state.activeTerminalId ? [state.activeTerminalId] : []),
            ...existingIds,
            ...availableIds,
          ].filter((id, index, values) => values.indexOf(id) === index);
          return {
            terminalLayout: layout,
            terminalPaneIds: orderedIds.slice(
              0,
              Math.min(terminalPaneLimit(layout), orderedIds.length),
            ),
          };
        }),
      addTerminalPane: () =>
        set((state) => {
          const visibleIds = state.terminalLayout === "single"
            ? (state.activeTerminalId ? [state.activeTerminalId] : [])
            : state.terminalPaneIds;
          const next = state.terminalTabs.find((tab) => !visibleIds.includes(tab.id));
          if (!next) return {};
          const terminalPaneIds = [...visibleIds, next.id].slice(0, 4);
          return {
            terminalLayout:
              state.terminalLayout === "single"
                ? "columns"
                : terminalPaneIds.length > 2
                  ? "grid"
                  : state.terminalLayout,
            terminalPaneIds,
            activeTerminalId: next.id,
          };
        }),
      removeTerminalPane: (id) =>
        set((state) => {
          const terminalPaneIds = state.terminalPaneIds.filter((paneId) => paneId !== id);
          if (terminalPaneIds.length <= 1) {
            return {
              terminalLayout: "single",
              terminalPaneIds: [],
              activeTerminalId: terminalPaneIds[0] ?? state.activeTerminalId,
            };
          }
          return {
            terminalPaneIds,
            activeTerminalId:
              state.activeTerminalId === id ? terminalPaneIds[0] : state.activeTerminalId,
          };
        }),
      closeTerminal: (id) =>
        set((state) => {
          const index = state.terminalTabs.findIndex((tab) => tab.id === id);
          const terminalTabs = state.terminalTabs.filter(
            (tab) => tab.id !== id,
          );
          const nextTab = terminalTabs[Math.min(index, terminalTabs.length - 1)];
          const terminalPaneIds = state.terminalPaneIds.filter((paneId) => paneId !== id);
          return {
            terminalTabs,
            terminalLayout: terminalPaneIds.length > 1 ? state.terminalLayout : "single",
            terminalPaneIds: terminalPaneIds.length > 1 ? terminalPaneIds : [],
            activeTerminalId:
              state.activeTerminalId === id
                ? (terminalPaneIds[0] ?? nextTab?.id ?? null)
                : state.activeTerminalId,
          };
        }),
    }),
);

export function createPersistentSnapshot(state: AppState): PersistentAppState {
  return {
    preferences: loadPreferences(),
    profiles: state.profiles,
    groups: state.groups,
    identities: state.identities,
    recentProfileIds: state.recentProfileIds,
    terminalTabs: state.terminalTabs.map((tab) => ({
      ...tab,
      sessionPassword: undefined,
      sessionKeyPassphrase: undefined,
      restored: undefined,
    })),
    activeTerminalId: state.activeTerminalId,
    terminalLayout: state.terminalLayout,
    terminalPaneIds: state.terminalPaneIds,
  };
}
