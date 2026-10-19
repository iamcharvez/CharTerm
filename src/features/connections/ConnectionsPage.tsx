import { invoke } from "@tauri-apps/api/core";
import {
  Cable,
  Check,
  Copy,
  Folder,
  FolderHeart,
  FolderPlus,
  FolderTree,
  LockKeyhole,
  Network,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  descendantGroupIds,
  flattenConnectionGroups,
} from "../../lib/connectionGroups";
import { useAppStore } from "../../stores/useAppStore";

type ConnectionsPageProps = { mode: "all" | "favorites" | "recent" };
type GroupEditor = {
  kind: "create" | "rename";
  value: string;
  parentId: string | null;
  groupId?: string;
};

const pageCopy = {
  all: {
    eyebrow: "Your workspace",
    title: "Saved Connections",
    empty: "No saved connections yet",
  },
  favorites: {
    eyebrow: "Pinned profiles",
    title: "Favorites",
    empty: "No favorite connections yet",
  },
  recent: {
    eyebrow: "Session history",
    title: "Recent Sessions",
    empty: "No recent saved sessions yet",
  },
};

export function ConnectionsPage({ mode }: ConnectionsPageProps) {
  const profiles = useAppStore((state) => state.profiles);
  const groups = useAppStore((state) => state.groups);
  const recentIds = useAppStore((state) => state.recentProfileIds);
  const navigate = useAppStore((state) => state.navigate);
  const openConnection = useAppStore((state) => state.openConnection);
  const editConnection = useAppStore((state) => state.editConnection);
  const deleteProfile = useAppStore((state) => state.deleteProfile);
  const duplicateProfile = useAppStore((state) => state.duplicateProfile);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const addGroup = useAppStore((state) => state.addGroup);
  const renameGroup = useAppStore((state) => state.renameGroup);
  const deleteGroup = useAppStore((state) => state.deleteGroup);
  const moveProfileToGroup = useAppStore((state) => state.moveProfileToGroup);
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<"all" | "ungrouped" | string>("all");
  const [editor, setEditor] = useState<GroupEditor | null>(null);

  const flatGroups = useMemo(() => flattenConnectionGroups(groups), [groups]);
  const groupPaths = useMemo(
    () => new Map(flatGroups.map((group) => [group.id, group.path])),
    [flatGroups],
  );

  useEffect(() => {
    if (
      selectedGroup !== "all" &&
      selectedGroup !== "ungrouped" &&
      !groups.some((group) => group.id === selectedGroup)
    ) {
      setSelectedGroup("all");
    }
  }, [groups, selectedGroup]);

  const modeProfiles = useMemo(
    () =>
      mode === "favorites"
        ? profiles.filter((profile) => profile.favorite)
        : mode === "recent"
          ? recentIds
              .map((id) => profiles.find((profile) => profile.id === id))
              .filter((profile) => profile !== undefined)
          : [...profiles].sort(
              (a, b) =>
                (b.lastUsedAt ?? b.createdAt) -
                (a.lastUsedAt ?? a.createdAt),
            ),
    [mode, profiles, recentIds],
  );

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const selectedIds =
      mode === "all" &&
      selectedGroup !== "all" &&
      selectedGroup !== "ungrouped"
        ? descendantGroupIds(groups, selectedGroup)
        : null;

    return modeProfiles.filter((profile) => {
      const inGroup =
        mode !== "all" ||
        selectedGroup === "all" ||
        (selectedGroup === "ungrouped"
          ? !profile.groupId
          : Boolean(profile.groupId && selectedIds?.has(profile.groupId)));
      if (!inGroup) return false;
      if (!normalizedQuery) return true;

      return [
        profile.name,
        profile.host,
        profile.username,
        profile.serialPort,
        profile.protocol,
        profile.groupId ? groupPaths.get(profile.groupId) : "ungrouped",
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [groupPaths, groups, mode, modeProfiles, query, selectedGroup]);

  const copy = pageCopy[mode];
  const filtering = Boolean(query.trim()) || (mode === "all" && selectedGroup !== "all");

  const removeProfile = async (
    profileId: string,
    hasSavedPassword?: boolean,
  ) => {
    if (hasSavedPassword) {
      try {
        await invoke("delete_connection_password", { profileId });
      } catch (reason) {
        window.alert(String(reason));
        return;
      }
    }
    deleteProfile(profileId);
  };

  const submitEditor = () => {
    if (!editor?.value.trim()) return;
    if (editor.kind === "rename" && editor.groupId) {
      renameGroup(editor.groupId, editor.value);
    } else {
      const id = addGroup(editor.value, editor.parentId);
      setSelectedGroup(id);
    }
    setEditor(null);
  };

  const removeGroup = (groupId: string) => {
    const group = groups.find((item) => item.id === groupId);
    if (!group) return;
    if (
      !window.confirm(
        `Remove “${group.name}”? Its connections and subgroups will be moved up one level, not deleted.`,
      )
    ) {
      return;
    }
    setSelectedGroup(group.parentId ?? "all");
    deleteGroup(groupId);
  };

  const groupCount = (groupId: string) => {
    const ids = descendantGroupIds(groups, groupId);
    return profiles.filter(
      (profile) => profile.groupId && ids.has(profile.groupId),
    ).length;
  };

  return (
    <main className="workspace-page connection-page">
      <header className="workspace-header">
        <div>
          <span>{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>
            Find, organize, and reconnect to devices without retyping details.
            Saved passwords stay in your operating system credential vault.
          </p>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={() => navigate("quick-connect")}
        >
          <Plus size={17} /> New connection
        </button>
      </header>

      <div className="connection-searchbar">
        <Search size={18} />
        <input
          aria-label="Search saved connections"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, host, username, protocol, or group…"
          type="search"
          value={query}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={16} />
          </button>
        )}
      </div>

      <div className={`connection-library ${mode !== "all" ? "without-groups" : ""}`}>
        {mode === "all" && (
          <aside className="group-panel" aria-label="Connection groups">
            <div className="group-panel-header">
              <div>
                <FolderTree size={17} />
                <strong>Groups</strong>
              </div>
              <button
                type="button"
                title="Create main group"
                aria-label="Create main group"
                onClick={() =>
                  setEditor({ kind: "create", value: "", parentId: null })
                }
              >
                <FolderPlus size={17} />
              </button>
            </div>

            {editor?.kind === "create" && editor.parentId === null && (
              <GroupEditorRow
                editor={editor}
                onChange={(value) => setEditor({ ...editor, value })}
                onCancel={() => setEditor(null)}
                onSubmit={submitEditor}
              />
            )}

            <nav className="group-tree">
              <button
                className={`group-row ${selectedGroup === "all" ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedGroup("all")}
              >
                <Network size={16} /> <span>All connections</span>
                <small>{profiles.length}</small>
              </button>
              <button
                className={`group-row ${selectedGroup === "ungrouped" ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedGroup("ungrouped")}
              >
                <Folder size={16} /> <span>Ungrouped</span>
                <small>{profiles.filter((profile) => !profile.groupId).length}</small>
              </button>

              {flatGroups.map((group) => (
                <div className="group-tree-item" key={group.id}>
                  {editor?.kind === "rename" && editor.groupId === group.id ? (
                    <GroupEditorRow
                      depth={group.depth}
                      editor={editor}
                      onChange={(value) => setEditor({ ...editor, value })}
                      onCancel={() => setEditor(null)}
                      onSubmit={submitEditor}
                    />
                  ) : (
                    <button
                      className={`group-row ${selectedGroup === group.id ? "active" : ""}`}
                      style={{ "--group-depth": group.depth } as CSSProperties}
                      type="button"
                      title={group.path}
                      onClick={() => setSelectedGroup(group.id)}
                    >
                      <Folder size={16} /> <span>{group.name}</span>
                      <small>{groupCount(group.id)}</small>
                      <span className="group-actions">
                        <span
                          role="button"
                          tabIndex={0}
                          title="Add subgroup"
                          aria-label={`Add subgroup to ${group.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditor({
                              kind: "create",
                              value: "",
                              parentId: group.id,
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.click();
                          }}
                        >
                          <Plus size={14} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          title="Rename group"
                          aria-label={`Rename ${group.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditor({
                              kind: "rename",
                              value: group.name,
                              parentId: group.parentId,
                              groupId: group.id,
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.click();
                          }}
                        >
                          <Pencil size={13} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="danger"
                          title="Remove group"
                          aria-label={`Remove ${group.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeGroup(group.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.click();
                          }}
                        >
                          <Trash2 size={13} />
                        </span>
                      </span>
                    </button>
                  )}
                  {editor?.kind === "create" && editor.parentId === group.id && (
                    <GroupEditorRow
                      depth={group.depth + 1}
                      editor={editor}
                      onChange={(value) => setEditor({ ...editor, value })}
                      onCancel={() => setEditor(null)}
                      onSubmit={submitEditor}
                    />
                  )}
                </div>
              ))}
            </nav>
          </aside>
        )}

        <section className="connection-library-content">
          {visible.length === 0 ? (
            <div className="empty-profiles compact">
              <span>
                {mode === "favorites" ? (
                  <FolderHeart size={30} />
                ) : (
                  <Network size={30} />
                )}
              </span>
              <h2>{filtering ? "No matching connections" : copy.empty}</h2>
              <p>
                {filtering
                  ? "Try another search or choose a different group."
                  : "Create a connection profile, then place it in any main group or nested subgroup."}
              </p>
              {!filtering && (
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => navigate("quick-connect")}
                >
                  <Plus size={17} /> Open Quick Connect
                </button>
              )}
            </div>
          ) : (
            <div className="profiles-grid" aria-label={copy.title}>
              {visible.map((profile) => (
                <article className="profile-card" key={profile.id}>
                  <div className="profile-card-top">
                    <span className="profile-protocol-icon">
                      {profile.protocol === "serial" ? (
                        <Cable size={20} />
                      ) : (
                        <Wifi size={20} />
                      )}
                    </span>
                    <button
                      className={`favorite-button ${profile.favorite ? "active" : ""}`}
                      type="button"
                      onClick={() => toggleFavorite(profile.id)}
                      aria-label={
                        profile.favorite
                          ? "Remove from favorites"
                          : "Add to favorites"
                      }
                    >
                      <Star
                        size={17}
                        fill={profile.favorite ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                  <span className="profile-protocol">
                    {profile.protocol.toUpperCase()}
                  </span>
                  {profile.hasSavedPassword && (
                    <span className="credential-saved">
                      <LockKeyhole size={11} /> Protected by system vault
                    </span>
                  )}
                  <h2>{profile.name}</h2>
                  <p>
                    {profile.protocol === "serial"
                      ? `${profile.serialPort} · ${profile.baudRate?.toLocaleString()} baud`
                      : `${profile.username ? `${profile.username}@` : ""}${profile.host}:${profile.port}`}
                  </p>
                  {mode === "all" && (
                    <label className="profile-group-select">
                      <Folder size={13} />
                      <select
                        aria-label={`Group for ${profile.name}`}
                        value={profile.groupId ?? ""}
                        onChange={(event) =>
                          moveProfileToGroup(profile.id, event.target.value || null)
                        }
                      >
                        <option value="">Ungrouped</option>
                        {flatGroups.map((group) => (
                          <option value={group.id} key={group.id}>
                            {`${"— ".repeat(group.depth)}${group.name}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="profile-actions">
                    <button
                      className="connect-profile-button"
                      type="button"
                      onClick={() => openConnection(profile)}
                    >
                      <Wifi size={16} /> Connect
                    </button>
                    <button
                      type="button"
                      onClick={() => editConnection(profile.id)}
                      title="Edit connection"
                      aria-label={`Edit ${profile.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateProfile(profile.id)}
                      title="Duplicate profile"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() =>
                        void removeProfile(profile.id, profile.hasSavedPassword)
                      }
                      title="Delete profile"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function GroupEditorRow({
  depth = 0,
  editor,
  onChange,
  onCancel,
  onSubmit,
}: {
  depth?: number;
  editor: GroupEditor;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="group-editor"
      style={{ "--group-depth": depth } as CSSProperties}
    >
      <input
        autoFocus
        maxLength={60}
        placeholder={editor.kind === "create" ? "Group name" : "Rename group"}
        value={editor.value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
          if (event.key === "Escape") onCancel();
        }}
      />
      <button type="button" onClick={onSubmit} aria-label="Save group">
        <Check size={14} />
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel">
        <X size={14} />
      </button>
    </div>
  );
}
