import { App } from '@capacitor/app';
import { SystemBars } from '@capacitor/core';
import { wireNativeApp, type AppPluginLike } from './nativeApp';
import { nativeBack } from './nativeBack';

/**
 * The only module that imports Capacitor plugins. Loaded lazily by `installNativeApp`, and only inside the app, so the browser build
 * never loads it (Vite emits it as its own chunk).
 */
export function installCapacitorBindings(): () => void {
  const app: AppPluginLike = {
    // `App.addListener` is overloaded per event name; every listener used here ignores its argument.
    addListener: (eventName, listener) => {
      if (eventName === 'backButton') return App.addListener('backButton', listener);
      if (eventName === 'pause') return App.addListener('pause', listener);
      return App.addListener('resume', listener);
    },
    minimizeApp: () => App.minimizeApp(),
  };
  return wireNativeApp(app, window, nativeBack, { hide: () => SystemBars.hide() });
}
