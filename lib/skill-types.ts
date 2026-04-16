/**
 * Skill system type definitions
 */

export interface SkillContext {
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}
