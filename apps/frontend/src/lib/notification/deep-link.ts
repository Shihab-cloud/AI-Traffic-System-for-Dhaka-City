import type { NotificationMetadata } from '@/lib/dtos/response/notification.res';
import { DocumentType } from '@/lib/enums/document-type.enum';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';
import { RouteUrls } from '@/lib/routes/route.config';

export type AppRole = RoleNameEnum;

const INBOX_ROUTE = '/notifications';

/**
 * A route is either:
 *  - a string base path → `${base}/${documentId}` is the resolved URL
 *  - an object `{ base, listOnly: true }` → `base` alone (no id appended)
 *
 * Use the object form when the document type has no per-id detail page
 * yet — the user lands on the list and can find the row from there.
 */
type Route = string | { base: string; listOnly: true };

/**
 * Per (documentType, role) routing.
 *
 * Adding a new document type or a new role for an existing type is a single
 * row here — no branching logic to touch.
 */
const DEEP_LINK_ROUTES: Partial<Record<DocumentType, Partial<Record<RoleNameEnum, Route>>>> = {
  [DocumentType.USER]: {
    [RoleNameEnum.ADMIN]: { base: RouteUrls.system.userManagement.index, listOnly: true },
  },
  [DocumentType.SUPPORT_TICKET]: {
    [RoleNameEnum.ADMIN]: RouteUrls.admin.support.index,
  },
};

/**
 * Maps a notification's metadata reference to a concrete in-app URL.
 *
 * The backend stores only `{ documentType, documentId }` pairs in metadata —
 * it does not know about FE route structure. This keeps route changes a FE
 * concern rather than a DB migration.
 */
export function getDeepLink(
  metadata: { ids?: { documentType: DocumentType; documentId: string }[] } | null | undefined,
  role: AppRole | undefined,
): string {
  const ref = metadata?.ids?.[0];
  if (!ref || !role) return INBOX_ROUTE;

  const route = DEEP_LINK_ROUTES[ref.documentType]?.[role];
  if (!route) return INBOX_ROUTE;
  if (typeof route === 'string') return `${route}/${ref.documentId}`;
  return route.base;
}

export type { NotificationMetadata };
