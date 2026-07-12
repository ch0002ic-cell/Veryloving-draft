import { TutorialPage } from '../../../src/components/TutorialPage';

export default function HomeModeTutorial() {
  return <TutorialPage titleKey="tutorial.homeTitle" subtitleKey="tutorial.homeSubtitle" nextPath="/(auth)/tutorial/guardian-mode" />;
}
