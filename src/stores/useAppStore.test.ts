import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";

describe("saved connection groups", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      page: "dashboard",
      terminalTabs: [],
      activeTerminalId: null,
      terminalLayout: "single",
      terminalPaneIds: [],
      editingProfileId: null,
      profiles: [],
      groups: [],
      recentProfileIds: [],
    });
  });

  it("opens a saved profile for editing and clears edit mode on navigation", () => {
    const profileId = useAppStore.getState().saveProfile({
      name: "File server",
      protocol: "sftp",
      host: "files.example.test",
      port: 22,
      username: "admin",
      hasSavedPassword: true,
    });

    useAppStore.getState().editConnection(profileId);
    expect(useAppStore.getState()).toEqual(
      expect.objectContaining({
        page: "quick-connect",
        editingProfileId: profileId,
      }),
    );

    useAppStore.getState().navigate("connections");
    expect(useAppStore.getState().editingProfileId).toBeNull();
  });

  it("opens a local shell as an optional terminal session", () => {
    useAppStore.getState().openLocalTerminal();

    const state = useAppStore.getState();
    expect(state.page).toBe("local-terminal");
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0]).toEqual(
      expect.objectContaining({ title: "Local 1", kind: "local" }),
    );
    expect(state.activeTerminalId).toBe(state.terminalTabs[0].id);
  });

  it("creates and collapses a multi-session terminal layout without closing sessions", () => {
    useAppStore.getState().openLocalTerminal();
    useAppStore.getState().openLocalTerminal();
    useAppStore.getState().setTerminalLayout("columns");

    let state = useAppStore.getState();
    expect(state.terminalLayout).toBe("columns");
    expect(state.terminalPaneIds).toHaveLength(2);

    useAppStore.getState().removeTerminalPane(state.terminalPaneIds[1]);
    state = useAppStore.getState();
    expect(state.terminalLayout).toBe("single");
    expect(state.terminalTabs).toHaveLength(2);
  });

  it("reduces a four-pane grid back to exactly two columns or rows", () => {
    for (let index = 0; index < 4; index += 1) {
      useAppStore.getState().openLocalTerminal();
    }
    useAppStore.getState().setTerminalLayout("grid");
    expect(useAppStore.getState().terminalPaneIds).toHaveLength(4);

    useAppStore.getState().setTerminalLayout("columns");
    expect(useAppStore.getState()).toEqual(
      expect.objectContaining({ terminalLayout: "columns" }),
    );
    expect(useAppStore.getState().terminalPaneIds).toHaveLength(2);
    expect(useAppStore.getState().terminalTabs).toHaveLength(4);

    useAppStore.getState().setTerminalLayout("grid");
    expect(useAppStore.getState().terminalPaneIds).toHaveLength(4);
    useAppStore.getState().setTerminalLayout("rows");
    expect(useAppStore.getState().terminalPaneIds).toHaveLength(2);
  });

  it("creates cascaded groups and safely moves their contents up on removal", () => {
    const rootId = useAppStore.getState().addGroup("Datacenter");
    const childId = useAppStore.getState().addGroup("Network Core", rootId);
    const profileId = useAppStore.getState().saveProfile({
      name: "Core switch",
      protocol: "ssh",
      host: "10.12.0.2",
      port: 22,
      groupId: childId,
    });

    useAppStore.getState().deleteGroup(rootId);
    expect(useAppStore.getState().groups).toEqual([
      expect.objectContaining({ id: childId, parentId: null }),
    ]);
    expect(useAppStore.getState().profiles[0]).toEqual(
      expect.objectContaining({ id: profileId, groupId: childId }),
    );

    useAppStore.getState().deleteGroup(childId);
    expect(useAppStore.getState().profiles[0].groupId).toBeUndefined();
  });
});
