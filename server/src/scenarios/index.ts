import type { ScenarioDefinition } from '../orchestration/ScenarioEngine';
import { aiAngelAutoDialScenario } from './aiAngelAutoDial';
import { cognitiveEngagementScenario } from './cognitiveEngagement';
import { emotionalCheckInScenario } from './emotionalCheckIn';
import { fallDetectionScenario } from './fallDetection';
import { medicationAdherenceScenario } from './medicationAdherence';

export {
  aiAngelAutoDialScenario,
  cognitiveEngagementScenario,
  emotionalCheckInScenario,
  fallDetectionScenario,
  medicationAdherenceScenario
};

export function createDefaultScenarioDefinitions(): readonly ScenarioDefinition[] {
  return Object.freeze([
    fallDetectionScenario,
    medicationAdherenceScenario,
    emotionalCheckInScenario,
    cognitiveEngagementScenario,
    aiAngelAutoDialScenario
  ]);
}
