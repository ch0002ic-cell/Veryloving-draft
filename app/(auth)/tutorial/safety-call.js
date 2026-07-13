import { TutorialPage } from '../../../src/components/TutorialPage';

export default function SafetyCallTutorial() {
  return <TutorialPage titleKey="tutorial.safetyCallTitle" subtitleKey="tutorial.safetyCallSubtitle" nextPath="/(auth)/completion" />;
}
