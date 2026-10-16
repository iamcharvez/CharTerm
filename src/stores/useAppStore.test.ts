import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";

describe("saved connection groups", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      page: "dashboard",
      terminalTabs: [],
      activeTerminalId: null,
      profiles: [],
      groups: [],
      recentProfileIds: [],
    });
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
