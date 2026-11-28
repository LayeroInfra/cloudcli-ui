import type { PinnedConversationListItem, Project, SessionWithProvider } from '@/shared/types';
import { buildProjectSessionTree } from '@/modules/sidebar/utils/projectSessionTree';

/** One pinned session with its forks, as the Pinned section above the projects draws it. */
export type PinnedSessionFamily = {
  pin: PinnedConversationListItem;
  projectId: string;
  projectDisplayName: string;
  rows: ReturnType<typeof buildProjectSessionTree>;
};

/**
 * Used by SidebarPinnedSessions: groups the pins into families, in pin order.
 *
 * Pinning a session carries its whole fork tree with it, as in Claude Code:
 * every loaded descendant is listed under it. A pinned session whose
 * ancestor is pinned too is shown inside that ancestor's family rather than
 * a second time on its own. Forks beyond a project's loaded page are not
 * known here and are left out until the page that holds them loads.
 */
export function buildPinnedSessionFamilies(pins: PinnedConversationListItem[], projects: Project[]): PinnedSessionFamily[] {
  const pinnedIds = new Set(pins.map((pin) => pin.sessionId));
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const loaded = new Map<string, SessionWithProvider>();
  const childrenOf = new Map<string, SessionWithProvider[]>();
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      const row = { ...session, __projectId: project.projectId } as SessionWithProvider;
      loaded.set(row.id, row);
    }
  }
  for (const session of loaded.values()) {
    const parentId = session.forkedFromSessionId;
    if (!parentId) continue;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(session);
    childrenOf.set(parentId, siblings);
  }

  /** Ancestor ids, nearest first, from loaded rows and the pin's own ancestry snapshot. */
  const ancestorsOf = (pin: PinnedConversationListItem): string[] => {
    const ids: string[] = [];
    const seen = new Set([pin.sessionId]);
    let parentId = loaded.get(pin.sessionId)?.forkedFromSessionId ?? pin.forkedFromSessionId ?? null;
    while (parentId && !seen.has(parentId)) {
      ids.push(parentId);
      seen.add(parentId);
      parentId = loaded.get(parentId)?.forkedFromSessionId
        ?? pin.forkAncestors?.find((ancestor) => ancestor.id === parentId)?.forkedFromSessionId
        ?? null;
    }
    return ids;
  };

  const families: PinnedSessionFamily[] = [];
  for (const pin of pins) {
    if (ancestorsOf(pin).some((id) => pinnedIds.has(id))) continue;
    // A pin whose session lost its project (the project was removed) has no
    // project to open it in or hang its tree from, so it is not drawn.
    const projectId = pin.projectId ?? loaded.get(pin.sessionId)?.__projectId;
    if (!projectId) continue;
    const root: SessionWithProvider = loaded.get(pin.sessionId) ?? ({
      id: pin.sessionId,
      summary: pin.sessionTitle,
      __provider: pin.provider,
      __projectId: projectId,
      lastActivity: pin.lastActivity ?? undefined,
    } as SessionWithProvider);
    const members: SessionWithProvider[] = [root];
    const queue = [root.id];
    const seen = new Set(queue);
    while (queue.length) {
      for (const child of childrenOf.get(queue.shift()!) ?? []) {
        if (seen.has(child.id) || child.__provider !== root.__provider) continue;
        seen.add(child.id);
        members.push(child);
        queue.push(child.id);
      }
    }
    // The root goes first whatever its age, so the tree hangs from it; the
    // rest keep newest-first, which the tree builder expects.
    const forks = members.slice(1).sort((a, b) => Date.parse(String(b.lastActivity ?? '')) - Date.parse(String(a.lastActivity ?? '')));
    // The family hangs from the pinned session: its own parent and every
    // ancestry snapshot are cut, or the tree builder would rebuild the
    // unpinned ancestors above it.
    const rows = buildProjectSessionTree(
      [{ ...root, forkedFromSessionId: null, forkAncestors: undefined }, ...forks.map((fork) => ({ ...fork, forkAncestors: undefined }))],
      projectId,
    );
    families.push({
      pin,
      projectId,
      projectDisplayName: projectById.get(projectId)?.displayName ?? pin.projectDisplayName,
      rows,
    });
  }
  return families;
}
