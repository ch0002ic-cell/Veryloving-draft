import { images } from '../constants/assets';

export const HUME_EVI_CONFIG_ID = 'e3d9acd6-22ea-4090-acfa-c354de25c05e';

export const voiceProfiles = [
  {
    id: 'capybara',
    displayName: 'Capybear',
    description: 'soft, calm, grounding',
    avatar: images.capybara,
    preview: require('../../assets/audio/offline/capybara/greeting-1.mp3'),
    humeVoiceID: 'capybear',
    characteristics: ['warm', 'patient', 'protective']
  },
  {
    id: 'bestie',
    displayName: 'Bestie',
    description: 'bright, reassuring, conversational',
    avatar: images.bestie,
    preview: require('../../assets/audio/offline/bestie/greeting-1.mp3'),
    humeVoiceID: 'bestie',
    characteristics: ['playful', 'supportive', 'direct']
  },
  {
    id: 'boyfriend',
    displayName: 'Boyfriend',
    description: 'steady, affectionate, present',
    avatar: images.boyfriend,
    preview: require('../../assets/audio/offline/boyfriend/greeting-1.mp3'),
    humeVoiceID: 'boyfriend',
    characteristics: ['gentle', 'romantic', 'calm']
  },
  {
    id: 'muscleMan',
    displayName: 'Muscleman',
    description: 'confident, protective, motivating',
    avatar: images.muscleMan,
    preview: require('../../assets/audio/offline/muscleMan/greeting-1.mp3'),
    humeVoiceID: 'muscleman',
    characteristics: ['bold', 'protective', 'energizing']
  }
];
