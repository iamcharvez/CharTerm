import type { ConnectionGroup } from "../stores/useAppStore";

export type FlatConnectionGroup = ConnectionGroup & {
  depth: number;
  path: string;
};

export function flattenConnectionGroups(
  groups: ConnectionGroup[],
  parentId: string | null = null,
  depth = 0,
  parentPath = "",
  visited = new Set<string>(),
): FlatConnectionGroup[] {
  return groups
    .filter((group) => group.parentId === parentId && !visited.has(group.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((group) => {
      const path = parentPath ? `${parentPath} / ${group.name}` : group.name;
      const nextVisited = new Set(visited).add(group.id);
      return [
        { ...group, depth, path },
        ...flattenConnectionGroups(
          groups,
          group.id,
          depth + 1,
          path,
          nextVisited,
        ),
      ];
    });
}

export function descendantGroupIds(
  groups: ConnectionGroup[],
  groupId: string,
): Set<string> {
  const ids = new Set<string>([groupId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }

  return ids;
}
