import { images } from './assets';

// These IDs are first-party persona identifiers, not provider resource IDs.
// The authenticated voice gateway resolves them to allowlisted Hume voice
// UUIDs from server-only configuration.
export const voiceProfiles = Object.freeze([
  {
    id: 'capybara',
    displayName: 'Capybear',
    description: 'soft, calm, grounding',
    avatar: images.capybara,
    preview: require('../../assets/audio/offline/capybara/greeting-1.mp3'),
    characteristics: ['warm', 'patient', 'protective']
  },
  {
    id: 'bestie',
    displayName: 'Bestie',
    description: 'bright, reassuring, conversational',
    avatar: images.bestie,
    preview: require('../../assets/audio/offline/bestie/greeting-1.mp3'),
    characteristics: ['playful', 'supportive', 'direct']
  },
  {
    id: 'boyfriend',
    displayName: 'Boyfriend',
    description: 'steady, affectionate, present',
    avatar: images.boyfriend,
    preview: require('../../assets/audio/offline/boyfriend/greeting-1.mp3'),
    characteristics: ['gentle', 'romantic', 'calm']
  },
  {
    id: 'muscleMan',
    displayName: 'Muscleman',
    description: 'confident, protective, motivating',
    avatar: images.muscleMan,
    preview: require('../../assets/audio/offline/muscleMan/greeting-1.mp3'),
    characteristics: ['bold', 'protective', 'energizing']
  }
]);
