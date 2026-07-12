import { TutorialPage } from '../../../src/components/TutorialPage';

export default function EmergencyModeTutorial() {
  return <TutorialPage titleKey="tutorial.emergencyTitle" subtitleKey="tutorial.emergencySubtitle" nextPath="/(auth)/tutorial/excuse-call" />;
}
