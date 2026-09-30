/**
 * Permission matrix. Three roles:
 *   admin — runs the workspace: users, settings, all videos, audit log
 *   md    — management: sees every clip and result, can reconfigure any analysis, no user/settings control
 *   operation — works their own demo clips: upload, draw zones, analyse, ask; sees only what they uploaded
 */
export const ROLES = ['admin', 'md', 'operation']
export const ROLE_LABEL = { admin: 'Admin', md: 'MD', operation: 'Operation' }

const MATRIX = {
  'users.manage': ['admin'],
  'settings.manage': ['admin'],
  'audit.view': ['admin'],
  'videos.viewAll': ['admin', 'md'],
  'videos.editAll': ['admin', 'md'],
  'videos.deleteAll': ['admin'],
  'videos.use': ['admin', 'md', 'operation'],
}
export const can = (user, perm) => Boolean(user && MATRIX[perm]?.includes(user.role))
export const permissionsFor = (user) => Object.keys(MATRIX).filter((p) => can(user, p))
export const ownsVideo = (user, v) => v.owner_user_id === user.id || v.created_by === user.id
export const canSeeVideo = (user, v) => can(user, 'videos.viewAll') || ownsVideo(user, v)
export const canEditVideo = (user, v) => can(user, 'videos.editAll') || ownsVideo(user, v)
export const canDeleteVideo = (user, v) => can(user, 'videos.deleteAll') || ownsVideo(user, v)
