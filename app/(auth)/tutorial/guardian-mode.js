import { TutorialPage } from '../../../src/components/TutorialPage';

export default function GuardianModeTutorial() {
  return <TutorialPage titleKey="tutorial.guardianTitle" subtitleKey="tutorial.guardianSubtitle" nextPath="/(auth)/tutorial/emergency-mode" />;
}
