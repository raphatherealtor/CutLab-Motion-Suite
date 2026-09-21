/**
 * Motion utility functions
 */

let _motionIdCounter = 0;

export function generateMotionId(prefix = 'mid'): string {
  _motionIdCounter++;
  return `${prefix}-${Date.now()}-${_motionIdCounter}`;
}
