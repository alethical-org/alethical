import { registerRootComponent } from 'expo';

import App from './App';
import { preloadScreenForPath } from './src/navigation/screenPreload';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately

// On the web, fetch this address's screen before React draws for the first time.
// React empties the app's mount point on that first draw, and the server's
// readable text sits inside it (src/lib/pageSnapshot.ts), so drawing before the
// screen is ready would swap real words for an empty box. Waiting keeps the text
// up until the screen itself can replace it. Nothing waits on a native build,
// where there is no server-written text and no separate download.
if (typeof document === 'undefined') {
  registerRootComponent(App);
} else {
  void preloadScreenForPath(window.location.pathname).then(() => registerRootComponent(App));
}
