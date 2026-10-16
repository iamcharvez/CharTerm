import { describe, expect, it } from "vitest";
import {
  descendantGroupIds,
  flattenConnectionGroups,
} from "./connectionGroups";
import type { ConnectionGroup } from "../stores/useAppStore";

const groups: ConnectionGroup[] = [
  { id: "sites", name: "Sites", parentId: null, createdAt: 1 },
  { id: "manila", name: "Manila", parentId: "sites", createdAt: 2 },
  { id: "core", name: "Core", parentId: "manila", createdAt: 3 },
  { id: "labs", name: "Labs", parentId: null, createdAt: 4 },
];

describe("connection group hierarchy", () => {
  it("flattens cascaded groups with depth and breadcrumbs", () => {
    expect(flattenConnectionGroups(groups)).toEqual([
      { ...groups[3], depth: 0, path: "Labs" },
      { ...groups[0], depth: 0, path: "Sites" },
      { ...groups[1], depth: 1, path: "Sites / Manila" },
      { ...groups[2], depth: 2, path: "Sites / Manila / Core" },
    ]);
  });

  it("selects a group and every nested subgroup", () => {
    expect([...descendantGroupIds(groups, "sites")]).toEqual([
      "sites",
      "manila",
      "core",
    ]);
  });
});
