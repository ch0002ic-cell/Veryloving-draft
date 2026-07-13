import { TutorialPage } from '../../../src/components/TutorialPage';

export default function ChooseVoiceTutorial() {
  return <TutorialPage titleKey="tutorial.chooseVoiceTitle" subtitleKey="tutorial.chooseVoiceSubtitle" nextPath="/(auth)/completion" />;
}
