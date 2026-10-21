import { formatPercent } from '../../../audio/audioSettings';
import { choiceLabel } from '../../../audio/musicTracks';
import type { MenuContext, PageNav } from '../context';
import type { PageDef } from '../menuView';
import { MenuChoice, MenuStepper, type PageKit } from '../widgets';
import { backButton, keyHint, pageTitle, rowY } from './common';

/**
 * AUDIO: music on / off, the soundtrack, the music volume and the effects volume. The same page opens from the title and the pause
 * screens; every control calls the `AudioDirector` directly, so a change is applied and saved at once (nothing here has an Apply button).
 */
export function buildAudioPage(kit: PageKit, ctx: MenuContext, nav: PageNav): PageDef {
  const { audio } = ctx;
  pageTitle(kit, 'AUDIO');
  new MenuChoice(kit, {
    id: 'music',
    label: 'MUSIC',
    y: rowY(0),
    options: ['ON', 'OFF'],
    selected: () => (audio.music.isMuted ? 1 : 0),
    onSelect: (index) => audio.music.setMuted(index === 1),
  });
  new MenuStepper(kit, {
    id: 'track',
    label: 'MUSIC TRACK',
    y: rowY(1),
    value: () => choiceLabel(audio.musicChoice).toUpperCase(),
    onAdjust: (direction) => void audio.cycleMusicChoice(direction),
  });
  new MenuStepper(kit, {
    id: 'music-volume',
    label: 'MUSIC VOLUME',
    y: rowY(2),
    value: () => formatPercent(audio.volume('music')),
    level: () => audio.volume('music'),
    dim: () => audio.music.isMuted,
    onAdjust: (direction) => void audio.adjustVolume('music', direction),
  });
  new MenuStepper(kit, {
    id: 'sfx-volume',
    label: 'SOUND EFFECTS',
    y: rowY(3),
    value: () => formatPercent(audio.volume('sfx')),
    level: () => audio.volume('sfx'),
    onAdjust: (direction) => void audio.adjustVolume('sfx', direction),
  });
  backButton(kit, () => nav.back());
  keyHint(kit, ctx, 'UP / DOWN: choose     LEFT / RIGHT: change     ESC: back');
  return { defaultFocus: 'music' };
}
