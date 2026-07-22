export const colors = {
  ink: '#304557',
  inkSoft: '#5F7484',
  cream: '#FFF8EF',
  paper: '#FFFFFF',
  orange: '#F47B45',
  gold: '#F6C45C',
  green: '#3AA76D',
  red: '#D94E4E',
  blue: '#3B82F6',
  orangeAccessible: '#A84316',
  goldAccessible: '#775400',
  greenAccessible: '#237A4B',
  redAccessible: '#B52F2F',
  blueAccessible: '#1C5FBF',
  line: '#E6ECEF',
  controlBorder: '#7C8C98',
  muted: '#F4F6F7',
  orangeSoft: '#FFF0E8',
  greenSoft: '#EAF7F0',
  redSoft: '#FFF0F0',
  blueSoft: '#EEF5FF',
  goldSoft: '#FFF7E2',
  focus: '#1C5FBF',
  scrim: 'rgba(20, 37, 49, 0.42)',
  scrimStrong: 'rgba(48, 69, 87, 0.86)',
  skeleton: '#DCE4E8',
  surfaceMapFallback: '#DDEBE7',

  // Semantic aliases keep product intent separate from the underlying palette.
  textPrimary: '#304557',
  textSecondary: '#5F7484',
  textInverse: '#FFFFFF',
  surfaceCanvas: '#FFF8EF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F4F6F7',
  borderSubtle: '#E6ECEF',
  borderControl: '#7C8C98',
  actionPrimary: '#304557',
  actionAccent: '#A84316',
  actionDanger: '#B52F2F',
  actionInversePressed: '#FFFFFF22'
};

export const tones = {
  neutral: { foreground: colors.textSecondary, background: colors.surfaceMuted, border: colors.borderSubtle },
  accent: { foreground: colors.orangeAccessible, background: colors.orangeSoft, border: '#F3CDBA' },
  info: { foreground: colors.blueAccessible, background: colors.blueSoft, border: '#C9DCF8' },
  warning: { foreground: colors.goldAccessible, background: colors.goldSoft, border: '#E8D39B' },
  success: { foreground: colors.greenAccessible, background: colors.greenSoft, border: '#C5E8D5' },
  danger: { foreground: colors.redAccessible, background: colors.redSoft, border: '#F2C9C9' }
};

export const fonts = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  display: 'Scada-Bold'
};

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  mdSm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48
};

export const radii = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  bubble: 18,
  pill: 999
};

export const typography = {
  displayLarge: { fontFamily: fonts.display, fontSize: 44, lineHeight: 52 },
  display: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  titleLarge: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 31 },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 27 },
  heading: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 25 },
  bodyLarge: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodySmall: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  emoji: { fontSize: 26, lineHeight: 34 },
  emojiLarge: { fontSize: 30, lineHeight: 38 }
};

export const sizes = {
  controlCompact: 44,
  control: 50,
  controlLarge: 56,
  iconSmall: 18,
  icon: 22,
  iconLarge: 28,
  touchTarget: 44,
  headerControl: 48
};

export const shadows = {
  subtle: {
    shadowColor: '#1A2E3D',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  raised: {
    shadowColor: '#1A2E3D',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3
  }
};

export const motion = {
  durationFast: 140,
  durationStandard: 180,
  durationEmphasis: 240,
  pressedScale: 0.98
};

export const layout = {
  contentMaxWidth: 720,
  readableMaxWidth: 560,
  screenPadding: 20,
  compactScreenPadding: 16
};
